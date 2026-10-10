import { buildApp } from './app.js';
import { config } from './config.js';
import { openDb } from './db.js';

const db = openDb(config.dataDir);
const { server, store, auth, monitor } = await buildApp(db, config, { logger: false });

if (!auth.hasPassword && !auth.setupPending) {
  // Nobody owns the site yet. Only someone who can read this log can claim it.
  const code = auth.issueSetupCode();
  console.log(`[flexihome] No password set. Open the site with  /#setup=${code}  on the end of its address to choose one (valid for 24 hours).`);
}

// A copy of the bookmarks every day they've changed, on top of the ones taken before risky edits.
const daily = () => store.snapshotIfDue('daily', 20 * 3600_000);
daily();
setInterval(daily, 3600_000).unref();

monitor.start();
await server.listen({ port: config.port, host: config.host });
console.log(`[flexihome] listening on ${config.host}:${config.port}${monitor.available ? '' : ' (no probe configured: Server tab off)'}`);

for (const sig of ['SIGINT', 'SIGTERM'] as const) {
  process.on(sig, () => {
    void server.close().then(() => {
      db.close();
      process.exit(0);
    });
  });
}
