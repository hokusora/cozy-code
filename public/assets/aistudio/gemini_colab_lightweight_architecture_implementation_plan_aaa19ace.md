# Technical Specification: Lightweight Browser-Based Notebook (Gemini Dark Mode)

## 1. Project Overview
Build a lightweight, Google Colab-style web notebook featuring a **Gemini Dark Mode** interface and **VS Code Dark Modern** syntax highlighting.
* **Persistence Rule:** Notebooks, text blocks, and code blocks persist across page refreshes via **IndexedDB (local cache)** and **Cloudflare D1 (cloud auto-sync)**. Execution outputs (`stdout`, `stderr`, plots, rendered tables) are strictly **ephemeral (RAM-only)** and clear completely upon page refresh (`F5`).
* **Multi-Notebook Support:** Sidebar to create, switch, rename, and delete multiple notebooks within a workspace.
* **Cross-Device Sync (Zero-Auth, No QR Required):** Access notebooks from any device immediately using a human-readable **Workspace Key / Passphrase** (e.g., `dev-alpha-2026`) hashed client-side into a `workspace_id` and synced automatically with Cloudflare D1.

---

## 2. Lightweight Tech Stack (Optimized for Low RAM & Fast Load)
* **Frontend Framework:** React 19 + TypeScript + Vite + Tailwind CSS (Initial bundle $< 150\text{ KB}$ gzipped).
* **Code Editor:** **CodeMirror 6** (`@uiw/react-codemirror` + `@uiw/codemirror-theme-vscode`). Chosen over Monaco Editor to reduce DOM nodes and RAM footprint by $\sim 90\%$ when rendering 30+ blocks.
* **Markdown & LaTeX Renderer:** `react-markdown` + `remark-math` + `rehype-katex` (`KaTeX` $\approx 300\text{ KB}$, avoiding heavy $50\text{ MB}$ TeXLive Wasm bundles).
* **Local Storage:** `idb-keyval` (lightweight IndexedDB wrapper, $< 1\text{ KB}$).
* **Backend & Database:** **Cloudflare Pages Functions** (Edge API in the same repo) + **Cloudflare D1** (Serverless SQLite, free tier: 5M reads/day, 100k writes/day).

---

## 3. System Architecture & Workflow

```text
+-----------------------------------------------------------------------+
|                     BROWSER (MAIN UI THREAD - <150KB)                 |
|  +-----------------------------------------------------------------+  |
|  | Gemini Dark UI (#131314)                                        |  |
|  | - Top Bar: Workspace Key Input (Cross-Device Sync) + Run All    |  |
|  | - Sidebar: Notebook List (Create / Switch / Delete)             |  |
|  | - Canvas: Ordered Text Blocks (Markdown/LaTeX) & Code Blocks    |  |
|  +-----------------------------------------------------------------+  |
|         | (1) Debounced Save (1000ms)             | (2) Lazy Run      |
|         v                                         v                   |
|  +-------------------------------+   +-----------------------------+  |
|  | Sync & Persistence Engine     |   | Ephemeral Output Store      |  |
|  | - IndexedDB (Instant Local)   |   | - React In-Memory State     |  |
|  | - POST /api/sync -> CF D1     |   | - Cleared on Page Refresh   |  |
|  +-------------------------------+   +-----------------------------+  |
+---------------------------------------------------^-------------------+
                                                    | (3) stdout/err
+---------------------------------------------------|-------------------+
|            LAZY-LOADED WEB WORKER SANDBOX (PER LANGUAGE)              |
|  * Instantiated ONLY when user clicks "Run" on that language          |
|  +-------------------+  +------------------+  +--------------------+  |
|  | Python (Pyodide)  |  | SQL (DuckDB)     |  | C++ / Java Runner  |  |
|  | Shared globals{}  |  | Shared :memory:  |  | JSCPP / Piston API |  |
|  +-------------------+  +------------------+  +--------------------+  |
+-----------------------------------------------------------------------+
```

### Execution & Sync Lifecycle
1. **Boot:** App reads `workspace_key` from `localStorage` (or URL `?w=key`), hashes it via `SHA-256` $\rightarrow$ `workspace_id`, loads cached notebooks from IndexedDB immediately, and fetches newer records from `GET /api/notebooks?wid={workspace_id}`.
2. **Edit:** Typing updates React state and saves to IndexedDB instantly; a `1000ms` debounce triggers `POST /api/sync` to upsert modified notebooks into Cloudflare D1.
3. **Run Block:** Clicking the block's **Play (`▶`)** button spawns the target language's Web Worker (if not yet active), executes the code inside the persistent runtime context, and streams `stdout`/`stderr` to the ephemeral output pane below the block.
4. **Refresh (`F5`):** RAM state resets (all outputs vanish); blocks reload intact from IndexedDB/D1.

---

## 4. UI/UX Specification (Gemini Dark Mode + VS Code Dark)
* **Color Tokens:**
  * App Background: `#131314`
  * Sidebar & Block Surface: `#1E1F20`
  * Block Hover / Active Toolbar: `#282A2C`
  * Hairline Borders: `#333537`
  * Primary Text: `#E3E3E3` | Secondary Text: `#C4C7C5`
  * Primary Accent (Run Button / Active Tab): `#A8C7FA`
  * Running Indicator: Animated gradient border (`#4285F4` $\rightarrow$ `#9B72CB` $\rightarrow$ `#D96570`)
* **Block Controls:**
  * **Code Block:** Left gutter with `▶` Run button and execution counter `[1]`; top-right language selector (`Python`, `SQL`, `C++`, `Java`, `LaTeX`), move up/down, and delete buttons; CodeMirror 6 editor with VS Code Dark Modern theme; collapsible output drawer below.
  * **Text Block:** Double-click to edit raw Markdown + `$LaTeX$`; blur or `Shift+Enter` to render formatted HTML + KaTeX math.
  * **Insert Divider:** Hovering between blocks reveals `+ Code` and `+ Text` pill buttons.

---

## 5. Cloudflare D1 Schema & Cross-Device Sync API

### D1 SQLite Schema (`schema.sql`)
```sql
CREATE TABLE IF NOT EXISTS notebooks (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL,
  title TEXT NOT NULL,
  blocks_json TEXT NOT NULL, -- JSON array: [{ id, type, language, content, order }]
  updated_at INTEGER NOT NULL,
  is_deleted INTEGER DEFAULT 0
);

CREATE INDEX IF NOT EXISTS idx_workspace ON notebooks(workspace_id, updated_at);
```

### Cross-Device Access Without Sign-In or QR Codes
* Top-left header displays an editable **Workspace Key** input (auto-generated 3-word slug like `cosmic-river-88` on first visit, editable by user to any custom secret passphrase).
* **Cross-Device Flow:** User opens the web app on Device B, types `cosmic-river-88` into the Workspace Key box (or visits `/?w=cosmic-river-88`), and D1 immediately syncs all notebooks matching `SHA-256("cosmic-river-88")`.
* **Conflict Resolution:** Last-Write-Wins (LWW) comparing `updated_at` timestamps per notebook, minimizing D1 write operations.

---

## 6. Multi-Language Stateful Execution & Edge-Case Handling

| Language | Runtime Engine | Stateful Sequential Mechanism | Browser RAM Footprint |
| :--- | :--- | :--- | :--- |
| **Python** | **Pyodide (Wasm)** | Single persistent `pyodide` worker per notebook; variables/imports in Block 1 remain in `globals()` for Block 2+. | $\sim 50\text{ MB}$ base; $\sim 500\text{ MB}$ with ML libs |
| **SQL** | **DuckDB-Wasm** | Single in-memory `:memory:` DB instance; `CREATE TABLE` in Block 1 is queryable in Block 2+. | $\sim 40\text{ MB}$ |
| **LaTeX** | **KaTeX** | Direct client-side DOM rendering (supports both inline `$ ... $` and block `$$ ... $$` equations). | $< 2\text{ MB}$ |
| **C++** | **JSCPP** (or Piston API) | Lightweight JS interpreter (`~500KB`) for instant browser execution, with optional stateless fallback to public Piston API (`emkc.org/api/v2/piston`) for full STL/C++20. | $< 5\text{ MB}$ |
| **Java** | **Piston API** (or CheerpJ) | Default to lightweight stateless REST execution via Piston API (`java`) to avoid downloading $40\text{ MB}$ JVM Wasm; auto-prepends previous helper classes if needed. | $< 1\text{ MB}$ |

### Python Packages & Edge-Case Safeguards
1. **Data Science & Audio Libraries (`numpy`, `pandas`, `scikit-learn`, `xgboost`, `mutagen`):**
   * Pre-compiled Wasm wheels (`numpy`, `pandas`, `scikit-learn`, `xgboost`) load dynamically via `await pyodide.loadPackage([...])` when detected in `import` statements.
   * Pure-Python PyPI packages (`mutagen`) install dynamically via `await micropip.install('mutagen')`.
2. **Fast Reloads (Service Worker Cache):** Cache `.wasm` and `.whl` artifacts in browser Cache Storage after first download so subsequent sessions initialize in $< 1\text{s}$.
3. **Infinite Loops & RAM Protection:**
   * Header includes a **Stop / Restart Kernel** button that calls `worker.terminate()` to immediately kill infinite loops (`while True:`) and reclaim $100\%$ of Wasm RAM without crashing the tab.
   * Enforce a 1-active-Pyodide-worker limit across notebooks (auto-suspend inactive notebook workers).

---

## 7. Project Directory Structure (Single-Repo Cloudflare Pages)
```text
├── functions/
│   └── api/
│       └── sync.ts          # Cloudflare Pages Function (GET & POST D1 sync)
├── src/
│   ├── components/
│   │   ├── Sidebar.tsx      # Multi-notebook manager
│   │   ├── Header.tsx       # Workspace Key switcher, Run All, Restart Kernel
│   │   ├── CodeBlock.tsx    # CodeMirror 6 + Run button + Ephemeral Output
│   │   └── TextBlock.tsx    # Markdown + KaTeX live editor/viewer
│   ├── workers/
│   │   ├── python.worker.ts # Pyodide + micropip stateful runner
│   │   └── sql.worker.ts    # DuckDB-Wasm stateful runner
│   ├── lib/
│   │   ├── runners.ts       # KaTeX, JSCPP, and Piston API (C++/Java) adapters
│   │   ├── storage.ts       # IndexedDB + debounced D1 sync engine
│   │   └── crypto.ts        # SHA-256 Workspace Key hashing
│   ├── App.tsx
│   └── index.css            # Gemini Dark Mode tokens & scrollbar styling
├── schema.sql               # Cloudflare D1 migration file
├── wrangler.toml            # D1 database binding config
└── package.json
```