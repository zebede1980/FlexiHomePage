import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { buildApp } from '../src/app.js';
import { connectOrigins } from '../src/config.js';
import { openDb } from '../src/db.js';

describe('CONNECT_SRC', () => {
  it('keeps plain origins only', () => {
    expect(connectOrigins('https://life.example.com, http://localhost:3061/ https://life.example.com')).toEqual([
      'https://life.example.com',
      'http://localhost:3061',
    ]);
    expect(connectOrigins("https://a.example/path https://b.example?x=1 'unsafe-eval' * javascript:alert(1) ftp://c.example")).toEqual([]);
    expect(connectOrigins('')).toEqual([]);
  });

  it('adds them to the page’s connect-src', async () => {
    const webDir = mkdtempSync(path.join(tmpdir(), 'fh-web-'));
    writeFileSync(path.join(webDir, 'index.html'), '<!doctype html><title>t</title>');
    const config = { port: 0, host: '127.0.0.1', dataDir: ':memory:', webDir, probeUrl: '', proxyHost: 'x', connectSrc: ['https://life.example.com'] };
    const app = await buildApp(openDb(':memory:'), config);
    const res = await app.server.inject({ method: 'GET', url: '/index.html' });
    expect(res.headers['content-security-policy']).toMatch(/connect-src 'self' https:\/\/life\.example\.com;/);
    await app.server.close();
  });
});
