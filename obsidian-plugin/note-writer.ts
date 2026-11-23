/**
 * note-writer.ts — JARVIS Obsidian note writer
 *
 * Creates or appends to Obsidian notes via the local REST API exposed by the
 * obsidian-local-rest-api community plugin (default port 27123).
 */

const OBSIDIAN_REST_API_PORT = 27123;

interface NoteWriteOptions {
  /** Vault-relative path, e.g. "Daily/2026-04-20.md". */
  path: string;
  /** Content to write (overwrites) or append. */
  content: string;
  /** When true, content is appended rather than overwritten. Default: false. */
  append?: boolean;
}

interface NoteWriteResult {
  ok: boolean;
  path: string;
  error?: string;
}

async function apiRequest(
  method: string,
  path: string,
  body?: string
): Promise<Response> {
  const url = `http://127.0.0.1:${OBSIDIAN_REST_API_PORT}/vault/${encodeURIComponent(path)}`;
  const headers: Record<string, string> = { 'Content-Type': 'text/markdown' };
  return fetch(url, { method, headers, body });
}

/**
 * Write or append to an Obsidian note.
 *
 * Requires the obsidian-local-rest-api plugin to be active in Obsidian.
 */
export async function writeNote(options: NoteWriteOptions): Promise<NoteWriteResult> {
  const { path, content, append = false } = options;

  try {
    let finalContent = content;

    if (append) {
      const getRes = await apiRequest('GET', path);
      if (getRes.ok) {
        const existing = await getRes.text();
        finalContent = existing + '\n' + content;
      }
    }

    const res = await apiRequest('PUT', path, finalContent);
    if (!res.ok) {
      const msg = await res.text().catch(() => res.statusText);
      return { ok: false, path, error: msg };
    }

    return { ok: true, path };
  } catch (err) {
    const error = err instanceof Error ? err.message : String(err);
    return { ok: false, path, error };
  }
}

/**
 * Check whether the Obsidian REST API is reachable.
 */
export async function isApiAvailable(): Promise<boolean> {
  try {
    const res = await fetch(`http://127.0.0.1:${OBSIDIAN_REST_API_PORT}/`, {
      signal: AbortSignal.timeout(1000),
    });
    return res.ok;
  } catch {
    return false;
  }
}
