# FlexiHome: project notes

See README.md for what the app is, the layout and the dev commands.

## Keep main in step with GitHub

GitHub Actions rebuilds the extension after every push to `main` and commits
it to `extension/` (`.github/workflows/build.yml`). So the local branch falls
one commit behind after each push.

- **Before starting any session of work:** `git pull`, then `git status -sb`
  to confirm `main` isn't behind `origin/main`. Do this before editing anything.
- **After every push:** give the "Build extension" workflow a minute, then
  `git pull` to fetch its `chore: build extension from …` commit before the
  next commit or push. If a push is rejected as non-fast-forward, this is why.
- Pulls should rebase: `git config pull.rebase true` (already set on the main
  dev PC; set it on any fresh clone you develop from).
- Never edit or commit `extension/` by hand; the workflow owns it. Local builds
  go to the ignored `dist/`.

## Two builds, one codebase

- `npm run build` is the **extension** (`dist/`, input `newtab.html`,
  `bridge.html`, `src/bridge/background.ts`). `npm run build:web` +
  `build:server` is the **hosted site** (`dist-web/`, `dist-server/`), which
  the Dockerfile runs. A change to shared page code affects both: run
  `npm run check`, `npm test` and both builds.
- Page code never calls `fetch` for bookmarks directly. It talks to
  `chrome.bookmarks`, which is the real API in the extension, the server
  stand-in on the site (`src/lib/server-chrome.ts`) and a fake under
  `npm run dev`. The server's bookmark store must keep behaving like
  `chrome.bookmarks` (`server/test/server.test.ts` checks it against the fake).
- The bridge's sync (`src/bridge/sync.ts`) is state-based and must never
  create a bookmark another linked browser's own sync will deliver. Any change
  there needs the two-browser tests in `src/bridge/sync.test.ts` to pass,
  including the long random one.
- Fastify rejects a request that sets `content-type: application/json` with an
  empty body, so every non-GET call from the page sends at least `{}`.
