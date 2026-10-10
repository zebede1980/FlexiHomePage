// SQLite via Node's built-in driver: no native build, one file in the data dir.

import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';

export type Db = DatabaseSync;

const MIGRATIONS: string[] = [
  `
  CREATE TABLE nodes (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    parent_id INTEGER REFERENCES nodes(id) ON DELETE CASCADE,
    pos INTEGER NOT NULL,
    title TEXT NOT NULL DEFAULT '',
    url TEXT,
    -- 'root', or which of the browser's fixed top-level folders this is ('bar', 'other', 'mobile').
    role TEXT,
    date_added INTEGER NOT NULL
  );
  CREATE INDEX nodes_parent ON nodes(parent_id, pos);

  CREATE TABLE meta (key TEXT PRIMARY KEY, value TEXT NOT NULL);

  CREATE TABLE sessions (
    hash TEXT PRIMARY KEY,
    label TEXT NOT NULL DEFAULT '',
    created_at INTEGER NOT NULL,
    seen_at INTEGER NOT NULL
  );

  -- Long-lived keys for the browser bridge.
  CREATE TABLE tokens (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    hash TEXT NOT NULL UNIQUE,
    name TEXT NOT NULL,
    created_at INTEGER NOT NULL,
    seen_at INTEGER
  );

  CREATE TABLE snapshots (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    created_at INTEGER NOT NULL,
    reason TEXT NOT NULL,
    rev INTEGER NOT NULL,
    tree TEXT NOT NULL
  );

  CREATE TABLE host_samples (
    ts INTEGER PRIMARY KEY,
    cpu REAL NOT NULL,
    mem REAL NOT NULL,
    load1 REAL NOT NULL,
    rx REAL NOT NULL,
    tx REAL NOT NULL
  );

  -- One row per app per hour: how many checks ran and how many passed.
  CREATE TABLE uptime (
    app TEXT NOT NULL,
    hour INTEGER NOT NULL,
    ok INTEGER NOT NULL DEFAULT 0,
    total INTEGER NOT NULL DEFAULT 0,
    PRIMARY KEY (app, hour)
  );

  CREATE TABLE incidents (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    app TEXT NOT NULL,
    started_at INTEGER NOT NULL,
    ended_at INTEGER,
    reason TEXT NOT NULL
  );
  CREATE INDEX incidents_app ON incidents(app, started_at);

  -- What the user changed about how an app is listed.
  CREATE TABLE app_prefs (
    app TEXT PRIMARY KEY,
    label TEXT,
    url TEXT,
    hidden INTEGER NOT NULL DEFAULT 0
  );
  `,
  // Which linked browser a bookmark came from (a bridge key's id); NULL when it was made on the site itself.
  `ALTER TABLE nodes ADD COLUMN origin INTEGER`,
  // Other machines that report in through the agent: their key, their last report, and a week of readings.
  `
  CREATE TABLE machines (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    hash TEXT NOT NULL UNIQUE,
    name TEXT NOT NULL,
    created_at INTEGER NOT NULL,
    seen_at INTEGER,
    report TEXT
  );

  CREATE TABLE machine_samples (
    machine INTEGER NOT NULL,
    ts INTEGER NOT NULL,
    cpu REAL NOT NULL,
    mem REAL NOT NULL,
    load1 REAL NOT NULL,
    rx REAL NOT NULL,
    tx REAL NOT NULL,
    -- NULL on a machine with no graphics card to read.
    gpu REAL,
    vram REAL,
    gpu_temp REAL,
    PRIMARY KEY (machine, ts)
  );
  `,
];

export function openDb(dataDir: string | ':memory:'): Db {
  let db: Db;
  if (dataDir === ':memory:') {
    db = new DatabaseSync(':memory:');
  } else {
    mkdirSync(dataDir, { recursive: true });
    db = new DatabaseSync(join(dataDir, 'flexihome.db'));
    db.exec('PRAGMA journal_mode = WAL');
  }
  db.exec('PRAGMA foreign_keys = ON');
  db.exec('PRAGMA busy_timeout = 5000');

  const { user_version: version } = db.prepare('PRAGMA user_version').get() as { user_version: number };
  for (let v = version; v < MIGRATIONS.length; v++) {
    db.exec('BEGIN');
    try {
      db.exec(MIGRATIONS[v]);
      db.exec(`PRAGMA user_version = ${v + 1}`);
      db.exec('COMMIT');
    } catch (e) {
      db.exec('ROLLBACK');
      throw e;
    }
  }
  return db;
}

/** Runs `fn` in a transaction. Nested calls join the outer one. */
export function tx<T>(db: Db, fn: () => T): T {
  if (db.isTransaction) return fn();
  db.exec('BEGIN IMMEDIATE');
  try {
    const out = fn();
    db.exec('COMMIT');
    return out;
  } catch (e) {
    db.exec('ROLLBACK');
    throw e;
  }
}

export function getMeta(db: Db, key: string): string | null {
  const row = db.prepare('SELECT value FROM meta WHERE key = ?').get(key) as { value: string } | undefined;
  return row?.value ?? null;
}

export function setMeta(db: Db, key: string, value: string | null) {
  if (value === null) db.prepare('DELETE FROM meta WHERE key = ?').run(key);
  else db.prepare('INSERT INTO meta (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value').run(key, value);
}
