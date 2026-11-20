// Cloudflare Pages Function: POST /api/execute (Proxied C++/Java execution via Piston or Wandbox)
interface Env {
  PISTON_API_URL?: string;
  PISTON_API_KEY?: string;
}

function normalizeJavaForWandbox(source: string): string {
  return source.replace(/(^|\n)\s*public\s+(final\s+|abstract\s+)?class\s+/g, '$1$2class ');
}

export const onRequestPost = async (context: { request: Request; env: Env }) => {
  const body = (await context.request.json().catch(() => null)) as {
    language?: 'cpp' | 'java';
    code?: string;
    stdin?: string;
  } | null;

  if (!body || (body.language !== 'cpp' && body.language !== 'java') || typeof body.code !== 'string') {
    return Response.json({ error: 'Invalid execution request.' }, { status: 400 });
  }

  const startedAt = Date.now();
  const { language, code, stdin = '' } = body;
  const pistonUrl = (context.env.PISTON_API_URL || '').trim();

  if (pistonUrl) {
    try {
      const headers: Record<string, string> = { 'Content-Type': 'application/json' };
      if (context.env.PISTON_API_KEY) {
        headers['Authorization'] = context.env.PISTON_API_KEY;
      }
      const res = await fetch(pistonUrl, {
        method: 'POST',
        headers,
        body: JSON.stringify({
          language: language === 'cpp' ? 'c++' : 'java',
          version: '*',
          files: [{ name: language === 'java' ? 'Main.java' : 'main.cpp', content: code }],
          stdin,
        }),
      });
      if (res.ok) {
        const data = (await res.json()) as {
          compile?: { stdout?: string; stderr?: string; code?: number };
          run?: { stdout?: string; stderr?: string; code?: number };
        };
        const stderr = [data.compile?.stderr, data.run?.stderr].filter(Boolean).join('\n');
        const exitCode =
          data.compile?.code && data.compile.code !== 0 ? data.compile.code : (data.run?.code ?? 0);
        return Response.json({
          stdout: data.run?.stdout || '',
          stderr,
          exitCode,
          provider: 'Piston API',
          durationMs: Date.now() - startedAt,
        });
      }
    } catch {
      // Fall through to Wandbox
    }
  }

  try {
    const compiler = language === 'cpp' ? 'gcc-head' : 'openjdk-head';
    const res = await fetch('https://wandbox.org/api/compile.json', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        compiler,
        code: language === 'java' ? normalizeJavaForWandbox(code) : code,
        options: language === 'cpp' ? 'warning,c++20' : undefined,
        stdin,
        save: false,
      }),
    });

    if (!res.ok) {
      throw new Error(`Wandbox returned ${res.status}`);
    }

    const data = (await res.json()) as {
      status?: string;
      compiler_error?: string;
      program_output?: string;
      program_error?: string;
      signal?: string;
    };

    const stderr = [
      data.compiler_error,
      data.program_error,
      data.signal ? `Terminated by signal: ${data.signal}` : '',
    ]
      .filter(Boolean)
      .join('\n');

    return Response.json({
      stdout: data.program_output || '',
      stderr,
      exitCode: Number(data.status ?? 0) || 0,
      provider: `Wandbox (${compiler})`,
      durationMs: Date.now() - startedAt,
    });
  } catch (err) {
    return Response.json(
      {
        stdout: '',
        stderr: err instanceof Error ? err.message : 'Remote compiler unavailable.',
        exitCode: 1,
        provider: 'Unavailable',
        durationMs: Date.now() - startedAt,
      },
      { status: 502 }
    );
  }
};
