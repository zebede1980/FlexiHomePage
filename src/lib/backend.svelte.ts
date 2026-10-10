// Where the page is running and how it talks to the FlexiHome server when it
// is the hosted site. The extension build never calls the server from here.

export type Mode = 'extension' | 'hosted' | 'mock';

export const mode: Mode =
  typeof location !== 'undefined' && location.protocol === 'chrome-extension:' ? 'extension' : import.meta.env.MODE === 'web' ? 'hosted' : 'mock';

export const hosted = mode === 'hosted';

export class ApiError extends Error {
  constructor(
    message: string,
    public status: number,
    /** Seconds to wait before trying again, when the server asked for a pause. */
    public wait = 0,
  ) {
    super(message);
  }
}

/** What the page knows about its sign-in. `signedIn: null` means "not asked yet". */
export const session = $state<{ signedIn: boolean | null; needsSetup: boolean; monitor: boolean; offline: boolean }>({
  signedIn: null,
  needsSetup: false,
  monitor: false,
  offline: false,
});

export async function api<T = unknown>(path: string, init: { method?: string; body?: unknown } = {}): Promise<T> {
  let res: Response;
  try {
    res = await fetch(path, {
      method: init.method ?? 'GET',
      credentials: 'same-origin',
      headers: { 'x-flexihome': '1', ...(init.body !== undefined ? { 'content-type': 'application/json' } : {}) },
      body: init.body !== undefined ? JSON.stringify(init.body) : undefined,
    });
  } catch {
    throw new ApiError("Can't reach the server.", 0);
  }
  if (res.status === 304) return undefined as T;
  const data = (await res.json().catch(() => ({}))) as { error?: string; wait?: number };
  if (!res.ok) {
    // Signed out elsewhere, or the password was changed: back to the sign-in screen.
    if (res.status === 401 && !path.startsWith('/api/auth/')) session.signedIn = false;
    throw new ApiError(data.error ?? `The server answered ${res.status}.`, res.status, data.wait ?? 0);
  }
  return data as T;
}

export async function refreshSession() {
  try {
    const s = await api<{ signedIn: boolean; needsSetup: boolean; monitor: boolean }>('/api/auth/state');
    Object.assign(session, s, { offline: false });
  } catch {
    // Server unreachable. If this browser has been signed in before, carry on and show the last copy.
    session.offline = true;
    session.signedIn = localStorage.getItem('flexihome:tree') !== null;
  }
}

export async function signOut() {
  await api('/api/auth/logout', { method: 'POST', body: {} }).catch(() => {});
  localStorage.removeItem('flexihome:tree');
  session.signedIn = false;
}
