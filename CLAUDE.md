# FlexiHome: project notes

README.md says what the app is and how to use it. This file is what a new
working session needs to know before touching it. The deeper design notes for
the hosted site and the browser bridge are in `docs/hosted-and-bridge.md`:
read that before changing anything under `server/` or `src/bridge/`.

## Where things stand (October 2026)

- `main` is the original Vivaldi extension only. It is what the owner's PCs
  `git pull` to get the extension, and the only branch CI builds.
- **`hosted` holds the hosted site, the Server tab and the two-way browser
  bridge.** It is pushed but **not yet merged into `main`**. The owner's PC
  turned out to hold no unpushed work (only npm's lockfile churn), so `hosted`
  is simply `main` plus its own commits and nothing else needs merging first.
  Ask before merging to or pushing `main`.
- The hosted site is deployed from `hosted` (see Deploying below).
- Not yet done by the owner at the time of writing: the reverse-proxy host for
  the site, choosing the site password, linking a real Vivaldi to it.
- **The bridge has run in real Vivaldi (8.2 on Windows), but only headless,
  with a throwaway profile and a throwaway server.** Linking, both directions
  of sync, the trash, the big-deletion question, the new-tab redirect and
  unlinking all worked there. That run found that Vivaldi's trash is a
  top-level folder titled "Deleted", not "Trash"; it is marked `trash: true`,
  and the code now goes by that flag (`isTrash` in `src/lib/tree.ts`). Still
  not seen for real: two machines sharing bookmarks through Vivaldi Sync (how
  quickly it delivers, and that nothing doubles), the browser's permission
  prompt when linking, and the owner's own profile and site.

## One codebase, two builds

| | Extension | Hosted site |
|---|---|---|
| Build | `npm run build` → `dist/` | `npm run build:web` → `dist-web/`, `npm run build:server` → `dist-server/` |
| Entry | `newtab.html`, `bridge.html`, `src/bridge/background.ts` | `index.html`, `server/src/index.ts` |
| Bookmarks | the browser's `chrome.bookmarks` | the server, through `src/lib/server-chrome.ts` |
| Told apart by | `location.protocol === 'chrome-extension:'` | `import.meta.env.MODE === 'web'` |

`src/lib/backend.svelte.ts` exports `mode` (`extension` / `hosted` / `mock`),
`hosted`, the `api()` helper and the `session` state. `npm run dev` is `mock`:
an in-memory `chrome.bookmarks` (`src/lib/mock-chrome.ts`).

Rules that keep the two builds one codebase:

- **Page code never fetches bookmarks itself.** It calls `chrome.bookmarks`,
  which is the real API in the extension, the server stand-in on the site and
  the fake in dev. So the bookmark store, settings sync and to-do list are the
  same code everywhere, and on the site the settings and to-dos still live in
  the two hidden "do not edit" bookmark folders.
- **The server's bookmark store must behave like `chrome.bookmarks`**: same
  node shape, same errors, and the same move-index quirk (the index is read
  before the node is taken out). `server/test/server.test.ts` runs one script
  of edits against both and compares the trees.
- A change to shared page code affects both builds. Before committing run
  `npm run check`, `npm test`, `npm run build` and `npm run build:web`.
- Anything hosted-only in the UI is behind `hosted` (or `session.monitor` for
  the Server tab); anything extension-only behind `mode === 'extension'`.

## Layout of the new parts

```
server/src/app.ts        every HTTP route; who may call what
server/src/bookmarks.ts  the bookmark tree (SQLite), batches, backups (snapshots)
server/src/auth.ts       one password, browser sessions, bridge keys, slow-down on wrong guesses
server/src/monitor.ts    Server tab data: app health, address checks, uptime, history
server/src/probe.ts      separate process: reads host /proc, /sys, Docker, the proxy's host list
server/src/docker.ts, npm-db.ts   reading containers and proxy hosts; shared by the probe and the agent
server/src/machines.ts   other machines that report in: their keys, and the checking of what they send
server/src/agent.ts, agent-lib.ts   separate program run ON those machines; Node built-ins only
scripts/install-agent.ps1         installs that agent on a Windows PC (copies four files out of dist-server)
server/src/favicons.ts   site icons fetched once (Google's service) and cached on disk
server/src/db.ts         schema as a list of migrations; add a new entry, never edit an old one
server/src/cli.ts        `flexihome reset-password | bridges | unlink <id>`
src/bridge/sync.ts       the two-way sync itself (pure: no chrome.* calls)
src/bridge/background.ts the extension's worker: when to sync, linking, the lease
src/bridge/Bridge.svelte the extension's "link this browser" page (bridge.html)
src/bridge/shared.ts     types shared by the worker and that page; what is kept in chrome.storage
src/components/ServerView.svelte, Sparkline.svelte, UptimeStrip.svelte   the Server tab
src/components/SignIn.svelte, HostedSettings.svelte                      hosted-only screens
```

## The things that are easy to break

- **Doubled bookmarks.** Two linked browsers that also share bookmarks through
  Vivaldi Sync must never both create the same new bookmark. The server records
  which bridge each bookmark came from (`origin`), one bridge at a time holds a
  lease to add site-made bookmarks, and everything else is left for Vivaldi
  Sync to deliver and is then matched by content. Any change to `sync.ts`, the
  lease route or `origin` needs every test in `src/bridge/sync.test.ts` to
  pass, including the long random two-browser one.
- **The worker must not swallow a real edit.** It cannot tell its own bookmark
  writes from the user's, so any bookmark event during a run earns one more
  run afterwards. Do not add a "ignore events for N seconds" window; that was
  tried and lost real changes.
- **Deletions.** A run that would remove more than about ten bookmarks returns
  `confirm` and changes nothing. Site-side deletions are moved to the
  browser's Trash, not destroyed. The server snapshots the tree before any
  batch that removes things. Keep all three.
- **The probe is the only holder of the Docker socket.** The web container
  must not be given it, and the probe must stay off any network with a route
  out and keep offering only `GET /snapshot` and `/health`.
- **A machine's key (`fhm_…`) must stay good for one thing only**: posting
  that machine's report to `/api/agent/report`. That route is in `OPEN` and
  checks the key itself; nothing else may accept one. Adding and removing
  machines is for a signed-in browser only, never a bridge key.
- **A report is from the internet.** Everything in it goes through
  `cleanReport()` (types, lengths, ranges) before it is stored or shown. The
  addresses it asks the site to try are only tried if they look public
  (`isPublicName`) and don't resolve to a private address (`publicLookup`),
  or a stolen key could make the site poke at its own network.
- **A machine that stops reporting is "off", not "down".** Its apps go to the
  `off` state, their incidents close, and their uptime isn't counted while it
  is off; only the machine's own row (`machine:<id>` in `uptime`) records the
  gap. Don't turn that into red alarms: a PC being switched off is normal.
- **The agent must import nothing but Node's own modules** (and types). The
  install script copies `agent.js`, `agent-lib.js`, `docker.js` and
  `npm-db.js` out of `dist-server/` to run alone; a new runtime import means a
  new file in that list in `scripts/install-agent.ps1`.
- **Requests with an empty JSON body.** Fastify answers 400 to a request that
  sets `content-type: application/json` and sends nothing. `api()` only sets
  the header when there is a body; every non-GET call passes at least `{}`.
- **Cookie-authenticated writes need the `x-flexihome: 1` header** (the
  cross-site forgery guard). `api()` adds it; raw `fetch` calls in tests must too.
- **`@fastify/static` v10 passes a FastifyReply to `setHeaders`**: use
  `.header()`, not `.setHeader()`.
- **Schema changes** go in as a new string at the end of `MIGRATIONS` in
  `db.ts`. The live database has already run the existing ones.

## Testing for real

- `npm test` covers the tree helpers, settings, the server (store, sign-in,
  routes, app-health rules), number formatting and the bridge's sync.
- A layout or behaviour change to the page should be looked at in a browser at
  desktop and phone width (390 px), on Home and on Server. Run a throwaway
  server (`npm run build:web && npm run build:server`, then
  `PORT=3031 DATA_DIR=<scratch> WEB_DIR=./dist-web node --disable-warning=ExperimentalWarning dist-server/index.js`),
  never the live one, for anything that writes bookmarks.
- The built extension can be driven headless: Playwright
  `launchPersistentContext` with `headless: false` plus the argument
  `--headless=new`, `--load-extension=<dir>`. `chrome.permissions.request`
  cannot be clicked there, so copy `dist/` and add `host_permissions` for the
  test origin to the copy's manifest.
- Real Vivaldi can be driven too, but not launched by Playwright (that
  hangs). Start it yourself with `--user-data-dir=<scratch> --headless=new
  --remote-debugging-port=9333 --load-extension=<dir>
  --disable-extensions-except=<dir>
  --disable-features=DisableLoadExtensionCommandLineSwitch about:blank` and
  attach with `chromium.connectOverCDP`. Reuse the tab that is open: asking
  for a new page never returns. Run `chrome.*` calls from `bridge.html`,
  because the worker goes to sleep.
- Playwright's `waitForFunction` with an `async` predicate resolves at once
  (a pending promise is truthy). Poll from Node instead, or the check passes
  while measuring nothing.
- Checking the live site needs a sign-in. Never ask for or store the owner's
  password: use `flexihome reset-password` for a one-time link, and if a
  throwaway password was set to test with, issue a fresh link afterwards so
  the owner's choice replaces it.

## Deploying the hosted site

The site runs from a second clone that only ever pulls, never edits:

1. Commit and push in the development clone.
2. In the deployment clone: `git pull`, then `docker compose up -d --build`.
3. Check: `docker ps --filter name=flexihome` shows `flexihome` and
   `flexihome-probe` healthy; `curl localhost:3030/api/health`.

The deployment clone has an untracked `.env` (sets `NPM_DB`) and a `data/`
directory owned by uid 1000; both are ignored by git and must survive a pull.
`data/flexihome.db` is the owner's bookmarks, settings and uptime history:
never delete it or the `data/` directory, and take a copy before any risky
migration. The reverse proxy must forward to `flexihome:3000` by container
name, with no access list (Basic Auth would clash with the bridge's key, which
uses the same `Authorization` header) and with HTTP/2 on (each open tab holds
one live-update connection).

## Keep main in step with GitHub

GitHub Actions rebuilds the extension after every push to `main` and commits
it to `extension/` (`.github/workflows/build.yml`). So the local branch falls
one commit behind after each push.

- **Before starting any session of work:** `git fetch`, `git status -sb`, and
  check which branch the work belongs on (see "Where things stand"). On `main`,
  `git pull` first and confirm it isn't behind `origin/main`.
- **After every push to `main`:** give the "Build extension" workflow a minute,
  then `git pull` to fetch its `chore: build extension from …` commit before the
  next commit or push. If a push is rejected as non-fast-forward, this is why.
- Pulls should rebase: `git config pull.rebase true` (already set on the main
  dev PC; set it on any fresh clone you develop from).
- Never edit or commit `extension/` by hand; the workflow owns it. Local builds
  go to the ignored `dist/`. The workflow does not run for `hosted`, so that
  branch's `extension/` folder is still the old extension: to try the bridge
  from that branch, build locally and load `dist/`.
- When `hosted` is merged into `main`, the workflow's `npm run check` and
  `npm test` now also cover the server (Node 22's built-in SQLite), and
  `npm run build` still produces the extension in `dist/`, so the workflow
  needs no change.
