import { createRoot } from 'react-dom/client';
import App from './App.tsx';
import './index.css';

// Register lightweight Cache Storage Service Worker for Pyodide & DuckDB Wasm/Whl caching
if ('serviceWorker' in navigator && window.location.protocol !== 'file:') {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/sw.js').catch(() => {
      // Service Worker optional in restricted sandboxes
    });
  });
}

createRoot(document.getElementById('root')!).render(<App />);
