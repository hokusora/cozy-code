const ADJECTIVES = [
  'amber', 'arctic', 'astral', 'azure', 'baltic', 'cobalt', 'cosmic', 'crimson',
  'lunar', 'misty', 'nordic', 'obsidian', 'orbital', 'polar', 'quartz', 'quiet',
  'silver', 'solar', 'velvet', 'zenith',
];

const NOUNS = [
  'atlas', 'canyon', 'comet', 'delta', 'fjord', 'glacier', 'harbor', 'horizon',
  'matrix', 'meadow', 'nebula', 'prism', 'pulse', 'ridge', 'river', 'signal',
  'summit', 'vector', 'vertex', 'voyage',
];

export function generateWorkspaceKey(): string {
  const randomBytes = new Uint8Array(3);
  crypto.getRandomValues(randomBytes);
  const adj = ADJECTIVES[randomBytes[0] % ADJECTIVES.length];
  const noun = NOUNS[randomBytes[1] % NOUNS.length];
  const num = 10 + (randomBytes[2] % 90);
  return `${adj}-${noun}-${num}`;
}

export async function hashWorkspaceKey(rawKey: string): Promise<string> {
  const normalized = rawKey.trim().toLowerCase();
  const encoder = new TextEncoder();
  const data = encoder.encode(`canvas-notebook:v1:${normalized}`);
  const hashBuffer = await crypto.subtle.digest('SHA-256', data);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  return hashArray.map((b) => b.toString(16).padStart(2, '0')).join('');
}

export function createId(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}
