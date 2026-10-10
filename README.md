# FlexiHome

A home page built on your bookmarks. It runs two ways from one codebase:

- **As a browser extension**: a new-tab page for Vivaldi (any Chromium browser
  works) showing your real browser bookmarks. No server needed.
- **As a site you host** (see [Host it as a site](#host-it-as-a-site)): the same
  page at your own address, so it also works on a phone, a tablet and any other
  browser, plus a **Server** tab showing how the machine and its apps are doing.
  The extension can then keep a browser's bookmarks in step with the site in
  both directions.

- **Your bookmarks, arranged.** Pick a home folder; its sub-folders become cards
  and loose bookmarks become pinned tiles across the top. Nested folders expand
  in place.
- **Rearrange by dragging.** Drag bookmarks between cards, into sub-folders, or
  onto the pinned row; drag a card's header to place it anywhere in any column
  (other cards stay put). Drop a link from the address bar onto a card to save
  it. Bookmark moves are real bookmark changes, so Vivaldi's bookmark panel
  stays in step; the card arrangement is a synced setting.
- **To-do list.** A card (top right to start with; drag it anywhere like the
  others) to jot tasks down and tick them off. Syncs with everything else, and
  can be hidden in settings.
- **Search.** Start typing anywhere: matches bookmarks by name, site and folder,
  goes straight to typed addresses, or searches the web.
- **Looks.** Pick a style: *Classic* (glass cards, light/dark/auto theme,
  accent colour, gradient or image backgrounds), *Aurora* (drifting colour in
  your accent that leans toward the pointer, glass cards whose edges light up
  as you pass, magnetic pinned icons), *Constellation* (a star
  field that reacts to the pointer, HUD-style panels) or *Dot Field* (warm
  light/dark paper, a dot grid that swells around the pointer, a magnifying
  dock for pinned links). Rest the pointer on a
  link for a preview. Card width and density work in every style; animation
  can be switched off and respects the system's reduce-motion setting.
- **Syncs between machines** via Vivaldi Sync, without a server (see below).

## Install in Vivaldi

The ready-built extension lives in `extension/`. GitHub rebuilds it on every
push to `main` (see `.github/workflows/build.yml`), so installing needs Git
but not Node:

```sh
git clone https://github.com/zebede1980/FlexiHomePage.git
```

1. Open `vivaldi://extensions`, turn on **Developer mode**, click **Load
   unpacked** and choose the `extension` folder.
2. Make it your new tab page: `vivaldi://settings/tabs` → **New Tab Page** →
   *Start Page*, and tick **Controlled by extension**. Vivaldi ignores the
   extension's request to take over new tabs until you do this. (The toolbar
   button opens the page at any time too.)

**To update:** `git pull`, then click the reload icon on the extension card in
`vivaldi://extensions`. After a push, give GitHub a minute or so to rebuild.

The manifest has a fixed `key`, so the extension ID is identical everywhere
(`aipidfmddcigondlplnilckkgnipngbp`) and
`chrome-extension://aipidfmddcigondlplnilckkgnipngbp/newtab.html` works as a
synced homepage URL.

## Host it as a site

One container serves the page and keeps the bookmarks (SQLite, in `./data`); a
small second one, the *probe*, reads the machine for the Server tab.

```sh
git clone https://github.com/zebede1980/FlexiHomePage.git && cd FlexiHomePage
mkdir -p data && sudo chown 1000:1000 data   # the container runs as uid 1000
echo "NPM_DB=/path/to/npm_data/database.sqlite" > .env   # optional, see below
docker compose up -d --build
docker logs flexihome                        # prints a one-time set-up link
```

Put it behind your reverse proxy with HTTPS (the compose file joins
`nginx-proxy-nw` and expects the proxy to target `http://flexihome:3000`; port
3030 is published on loopback only, for checks). Then open the address with the
`/#setup=…` code from the log on the end to choose the password. Browsers stay
signed in after that.

`docker exec -it flexihome flexihome reset-password` prints a fresh set-up
link if you forget it; `flexihome bridges` and `flexihome unlink <id>` manage
linked browsers.

### The Server tab

Uptime, processor, memory, disk and network for the machine, with an hour, a
day or a week of history, and a row per app: whether it is up, why not if it
isn't, its uptime hour by hour, and what it is using.

An "app" is a Docker container. If `NPM_DB` points at Nginx Proxy Manager's
database, each container is paired with the address that reaches it; that
address is then checked through the proxy every two minutes (any answer below
500 counts as alive, so a login prompt is fine), and proxy hosts that point at
a container that no longer exists are listed as down. Rename an app, give it a
different link or hide it from its row's menu.

The probe is the only thing given the Docker socket and the host's `/proc`,
`/sys` and `/` (all read-only). It has no published port, sits on a network
with no route out, and offers nothing but a read-only summary to the web
container, so the internet-facing process never holds that access itself.

### Linking a browser

Install the extension as below, open its options (the built-in page's settings
have a *Link to a FlexiHome site* button), enter the site's address and
password, and look over what linking would do before agreeing to it. From then
on:

- A bookmark added, renamed, moved or deleted in the browser reaches the site
  within a few seconds; a change made on the site reaches the browser within a
  minute. Deletions made on the site go to Vivaldi's Trash rather than vanishing.
- New tabs open the site (switchable). If the site can't be reached, the page
  built into the extension is shown instead; `newtab.html?local` always is.
- A run that would delete more than a handful of bookmarks stops and asks first.
  The site also keeps a copy of the bookmarks every day they change and before
  any large edit (Settings → Backups).

**Several browsers that already share bookmarks through Vivaldi Sync** can all
be linked. The catch with that is doubling: if two browsers each added a
bookmark that is new on the site, Vivaldi Sync would then deliver both copies
to both. So the site remembers where each bookmark came from, and one browser
at a time holds the job of adding the ones made on the site itself; the others,
and anything a linked browser made, arrive through Vivaldi Sync and are
recognised when they do. The job passes on if its holder hasn't checked in for
a day. A browser that shares bookmarks with no other can say so in the
extension's options and then takes everything directly.

How the sync decides what changed is described at the top of
`src/bridge/sync.ts`; `src/bridge/sync.test.ts` runs it against two browsers
and a stand-in for Vivaldi Sync.

## How sync works

*(This is the extension on its own, with no site. On the hosted site, settings
and to-dos are kept by the server, in the same hidden folders.)*

Bookmarks are Vivaldi's own, so they sync as normal.

Settings are trickier: Vivaldi doesn't sync extension storage between
machines. So FlexiHome saves its settings as a single bookmark whose URL is a
`data:` JSON payload, inside a folder called
**FlexiHome settings (do not edit)** under *Other bookmarks*. It rides along
with Vivaldi Sync like any bookmark. The page hides that folder.

- Settings are cached locally too, so pages open instantly.
- Nothing is written until you change a setting, so a fresh machine
  never overwrites your real config with defaults.
- Conflicts: the most recently changed copy wins. If two machines created the
  folder before syncing, the older duplicate is removed automatically.
- Folders are remembered by name path (e.g. `Bookmarks › Work`), not by ID,
  because bookmark IDs differ between machines.

The to-do list uses a second hidden folder, **FlexiHome to-do (do not edit)**,
with one bookmark per item (the title is the text, a `data:` URL holds whether
it's done). Because each item is its own bookmark, Vivaldi Sync merges them
individually: adding a task on one machine while ticking one off on another
loses neither. If two machines both create the folder before syncing, the
folders are merged.

## Development

```sh
npm run dev      # http://localhost:5173/newtab.html with a fake bookmark tree
npm test         # unit tests (tree helpers, settings, the server, the bridge's sync)
npm run check    # svelte-check and TypeScript, page and server
npm run build    # production extension in dist/ (load that to test before pushing)

# the hosted site
npm run dev:server   # the server on :3031 (data in ./data, no Server tab without PROBE_URL)
npm run dev:web      # the page against it, at http://localhost:5173/
npm run build:web && npm run build:server   # what the Dockerfile runs
```

`import.meta.env.MODE === 'web'` (set by `vite build --mode web`) is how the
page tells the hosted build from the extension. On the site, `chrome.bookmarks`
is a stand-in that calls the server (`src/lib/server-chrome.ts`), so the
bookmark store, settings sync and to-do list are the same code in both.

The dev server swaps in an in-memory, localStorage-backed `chrome.bookmarks`
(`src/lib/mock-chrome.ts`), so the UI can be worked on in an ordinary tab. Run
`__flexihomeResetMock()` in the console to restore the sample bookmarks. The
mock is not included in production builds.

Icons are generated by `npm run icons`. `node scripts/make-key.mjs` would mint
a new extension key (and therefore a new ID), so don't run it casually.

Because the build bot commits `extension/` after each push, your local `main`
is one commit behind afterwards; `git pull` before pushing again (this repo
is set to rebase on pull).

### Layout

```
public/            manifest, boot.js (pre-paint theme), icons
newtab.html        the extension's page; index.html is the hosted site's
bridge.html        the extension's "link this browser" page
src/App.svelte     page shell: theme, background, tabs, masonry of folder cards
src/components/    cards, rows, search, settings drawer, dialogs, toasts,
                   sign-in, the Server tab (ServerView, Sparkline, UptimeStrip)
src/bridge/        the extension's background worker and two-way sync
src/lib/backend.svelte.ts    which build this is; calls to the server
src/lib/server-chrome.ts     chrome.bookmarks answered by the server
server/src/        the hosted site: routes (app.ts), bookmark store, sign-in,
                   the Server tab's data (monitor.ts) and the probe (probe.ts)
src/lib/todos.ts   to-do items stored as bookmarks
src/lib/tree.ts    pure bookmark-tree helpers (paths, search, hidden folders)
src/lib/settings*.ts         settings schema and the bookmark-backed sync store
src/lib/bookmarks.svelte.ts  live bookmark tree + mutations
src/lib/styles.ts  style registry; palettes in src/styles/, flourishes as
                   :global([data-style=…]) rules in each component
src/lib/fx/        canvas backgrounds and pointer effects (Svelte actions)
prototypes/        standalone design prototypes (serve with `npm run dev`)
```

## Roadmap

- **Embedded panels:** web views of chosen sites (a Reddit thread, Gemini…),
  with a "mobile view" toggle. Needs `declarativeNetRequest` rules that strip
  frame-blocking headers and set a mobile user-agent, scoped to the panel's
  frames only.
- Purpose-built widgets where embedding falls short (e.g. a Reddit thread
  reader using Reddit's JSON).
- Per-device settings on the hosted site (a phone and a desktop currently
  share one layout).
- Alerts when an app on the Server tab goes down.
