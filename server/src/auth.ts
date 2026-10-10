// One owner, one password. Browsers hold a long-lived session cookie (a start
// page that keeps asking you to sign in is no start page); the browser bridge
// holds a named key that can be revoked on its own.

import { createHash, randomBytes, scrypt as scryptCb, timingSafeEqual } from 'node:crypto';
import { promisify } from 'node:util';
import { getMeta, setMeta, type Db } from './db.js';

const scrypt = promisify(scryptCb) as (pw: string, salt: Buffer, len: number, opts: object) => Promise<Buffer>;

const SCRYPT = { N: 1 << 16, r: 8, p: 1, maxmem: 160 * 1024 * 1024 };
const SESSION_IDLE_MS = 400 * 24 * 3600_000;
const SETUP_TTL_MS = 24 * 3600_000;
export const MIN_PASSWORD = 10;

const sha = (s: string) => createHash('sha256').update(s).digest('hex');
const newSecret = () => randomBytes(32).toString('base64url');

async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16);
  const key = await scrypt(password, salt, 32, SCRYPT);
  return `scrypt$${SCRYPT.N}$${SCRYPT.r}$${SCRYPT.p}$${salt.toString('base64')}$${key.toString('base64')}`;
}

async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const [kind, n, r, p, salt, key] = stored.split('$');
  if (kind !== 'scrypt') return false;
  const want = Buffer.from(key, 'base64');
  const got = await scrypt(password, Buffer.from(salt, 'base64'), want.length, { N: Number(n), r: Number(r), p: Number(p), maxmem: SCRYPT.maxmem });
  return timingSafeEqual(got, want);
}

/** Wrong guesses slow down per address: free for the first few, then a doubling wait. */
export class Limiter {
  #fails = new Map<string, { count: number; until: number }>();

  /** Seconds the caller still has to wait, or 0 if they may try now. */
  waitFor(key: string, now = Date.now()): number {
    const f = this.#fails.get(key);
    return f && f.until > now ? Math.ceil((f.until - now) / 1000) : 0;
  }

  fail(key: string, now = Date.now()) {
    const count = (this.#fails.get(key)?.count ?? 0) + 1;
    const wait = count < 5 ? 0 : Math.min(15 * 60_000, 2_000 * 2 ** (count - 5));
    this.#fails.set(key, { count, until: now + wait });
    if (this.#fails.size > 10_000) this.#fails.clear();
  }

  clear(key: string) {
    this.#fails.delete(key);
  }
}

export class Auth {
  readonly limiter = new Limiter();

  constructor(private db: Db) {}

  get hasPassword(): boolean {
    return getMeta(this.db, 'password') !== null;
  }

  /**
   * A one-time code that lets whoever holds it choose the password. Printed to
   * the server log on first start (and by `flexihome reset-password`), so only
   * someone with access to the machine can claim the site.
   */
  issueSetupCode(): string {
    const code = newSecret();
    setMeta(this.db, 'setup', JSON.stringify({ hash: sha(code), expires: Date.now() + SETUP_TTL_MS }));
    return code;
  }

  get setupPending(): boolean {
    const raw = getMeta(this.db, 'setup');
    return raw !== null && (JSON.parse(raw) as { expires: number }).expires > Date.now();
  }

  async setPasswordWithCode(code: string, password: string): Promise<boolean> {
    const raw = getMeta(this.db, 'setup');
    if (!raw) return false;
    const { hash, expires } = JSON.parse(raw) as { hash: string; expires: number };
    if (expires < Date.now() || hash !== sha(code)) return false;
    await this.setPassword(password);
    return true;
  }

  /** Also signs every browser out; bridge keys carry on working. */
  async setPassword(password: string) {
    setMeta(this.db, 'password', await hashPassword(password));
    setMeta(this.db, 'setup', null);
    this.db.prepare('DELETE FROM sessions').run();
  }

  async checkPassword(password: string): Promise<boolean> {
    const stored = getMeta(this.db, 'password');
    if (!stored) return false;
    return verifyPassword(password, stored);
  }

  // ---- browser sessions ----

  createSession(label: string): string {
    const secret = newSecret();
    const now = Date.now();
    this.db.prepare('INSERT INTO sessions (hash, label, created_at, seen_at) VALUES (?, ?, ?, ?)').run(sha(secret), label.slice(0, 200), now, now);
    return secret;
  }

  checkSession(secret: string | undefined): boolean {
    if (!secret) return false;
    const hash = sha(secret);
    const row = this.db.prepare('SELECT seen_at FROM sessions WHERE hash = ?').get(hash) as { seen_at: number } | undefined;
    if (!row) return false;
    const now = Date.now();
    if (now - row.seen_at > SESSION_IDLE_MS) {
      this.db.prepare('DELETE FROM sessions WHERE hash = ?').run(hash);
      return false;
    }
    if (now - row.seen_at > 3600_000) this.db.prepare('UPDATE sessions SET seen_at = ? WHERE hash = ?').run(now, hash);
    return true;
  }

  endSession(secret: string | undefined) {
    if (secret) this.db.prepare('DELETE FROM sessions WHERE hash = ?').run(sha(secret));
  }

  // ---- bridge keys ----

  createToken(name: string): { id: number; token: string } {
    const token = `fh_${newSecret()}`;
    const { lastInsertRowid } = this.db
      .prepare('INSERT INTO tokens (hash, name, created_at) VALUES (?, ?, ?)')
      .run(sha(token), name.slice(0, 80) || 'Browser', Date.now());
    return { id: Number(lastInsertRowid), token };
  }

  /** The key's id, or null if it isn't one of ours. */
  checkToken(token: string | undefined): number | null {
    if (!token) return null;
    const row = this.db.prepare('SELECT id, seen_at FROM tokens WHERE hash = ?').get(sha(token)) as { id: number; seen_at: number | null } | undefined;
    if (!row) return null;
    const now = Date.now();
    if (!row.seen_at || now - row.seen_at > 60_000) this.db.prepare('UPDATE tokens SET seen_at = ? WHERE id = ?').run(now, row.id);
    return row.id;
  }

  listTokens(): { id: number; name: string; createdAt: number; seenAt: number | null }[] {
    return (
      this.db.prepare('SELECT id, name, created_at, seen_at FROM tokens ORDER BY id').all() as unknown as {
        id: number;
        name: string;
        created_at: number;
        seen_at: number | null;
      }[]
    ).map((r) => ({ id: r.id, name: r.name, createdAt: r.created_at, seenAt: r.seen_at }));
  }

  revokeToken(id: number) {
    this.db.prepare('DELETE FROM tokens WHERE id = ?').run(id);
  }
}
