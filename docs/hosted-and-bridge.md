# The hosted site and the browser bridge: design notes

Written when both were first built (October 2026). README.md covers what they
do for a user; this is why they are built the way they are, for whoever
changes them next.

## Why a bridge at all

The owner wanted one start page for every browser and device, with his Vivaldi
bookmarks (desktop and laptop, kept alike by Vivaldi Sync) following it in both
directions. Vivaldi Sync has no public interface and its data is end-to-end
encrypted, so nothing on a server can read or write it. An extension is the
only thing that can touch a browser's real bookmarks, so the extension that
used to *be* the page also became the link between browser and site.

## The server

- Fastify, SQLite through Node's built-in `node:sqlite` (no native build; needs
  `--disable-warning=ExperimentalWarning` to stay quiet on Node 22).
- **Bookmarks** are rows in `nodes` (`parent_id`, `pos`). Ids are never reused
  (`AUTOINCREMENT`), which the bridge depends on. Ids 0, 1 and 2 are the root,
  the bookmark bar and "Other bookmarks", as in every Chromium browser; ordinary
  nodes start at 100. Top-level folders carry a `role` (`bar`, `other`,
  `mobile`) so two browsers map to the same ones whatever they call them.
- `rev` goes up by one with every change (a batch counts once). The page and
  the bridge both use it to ask "anything new?" cheaply (`GET /api/tree?rev=N`
  answers 304).
- `POST /api/batch` applies a list of changes as one transaction, with
  `baseRev` so a bridge never applies a diff worked out from an older tree
  (409, and the bridge reads again). `ref` names let later changes in the same
  batch point at nodes created earlier in it.
- **Live updates** are server-sent events on `/api/events` (one line per
  change, carrying the new `rev`). The page re-reads the tree when it sees a
  `rev` it doesn't have.
- **Sign-in**: one owner, one password (scrypt). No account exists until
  someone opens the one-time set-up link printed in the container log, so only
  a person with access to the machine can claim the site. Browsers hold a
  long-lived session cookie; bridges hold a named key (`fh_…`) that can be
  revoked alone. Wrong guesses slow down per address.
- **Backups**: `snapshots` keeps the last 40 copies of the whole tree, taken
  daily when it has changed, before any batch that removes things or is large,
  and before deleting a folder. Restoring puts nodes back with their original
  ids, so a linked browser sees ordinary edits rather than a different tree.

## The Server tab

- `probe.ts` runs as a second container from the same image. Every 10 seconds
  it reads `/proc` (processor, memory, load, uptime), `/sys/class/net` (traffic
  on real network cards only), `statfs` of the host root, the Docker API over
  its socket (state, health, restarts, processor and memory per container) and
  Nginx Proxy Manager's SQLite file (which address forwards to which container).
- `monitor.ts` in the web server polls the probe, and:
  - pairs containers with proxy hosts by container or Compose service name;
    a proxy host naming a container that doesn't exist becomes a "down" row;
  - checks each paired address **through the proxy container** (TLS with the
    right server name, so it also sees certificate expiry) every two minutes,
    sooner while failing; two failures in a row before it counts;
  - decides `up` / `degraded` / `down` and words the reason (`judge()`);
  - records one row per app per hour of checks passed and made (`uptime`),
    incidents with a start and end, and a per-minute host sample (`host_samples`).
- Processor share per container is its usage delta over the system delta from
  Docker's stats, so it is already a share of the whole machine.
- The address checks show up in the proxy's access logs with the user agent
  `FlexiHome-monitor`, which makes them easy to filter out.
- Only Docker containers are apps. Things running outside Docker appear only if
  a proxy host points at an address, and then only as an address check.

Charts follow a few fixed rules: one series per chart in the accent colour;
status colours (green, amber, red) are only ever used for state and always
come with an icon and a word; meters turn amber at 75% and red at 90%.

## The bridge's sync (`src/bridge/sync.ts`)

It works from state, not from a log of events. Each run:

1. Reads both trees. On the browser side, Trash and any managed folder are
   left out entirely, so a bookmark moved to Trash reads as deleted and one
   restored from it as new. Trash is found by Vivaldi's `trash: true` mark on
   the folder, not its title (which is "Deleted" in Vivaldi 8.2).
2. Maps the fixed top-level folders by role, then loads the stored **pairs**
   (browser id, server id, and the parent, title and address both sides had
   after the last run: the "base").
3. **Re-pairs** a node whose partner vanished if an identical unpaired node
   sits in the same folder (Vivaldi Sync can swap one copy of a duplicate for
   the other).
4. **Matches unpaired nodes by content**, folder by folder from the top: same
   folder, same kind, same title and address. This is how a browser that
   already has the bookmarks links without copying everything, and how a
   bookmark delivered by Vivaldi Sync is recognised. The settings bookmark is
   matched whatever its payload, and the newer copy wins (the browser's, on
   the first import to an empty site).
5. **Deletions**: a pair with one side gone. Only the top of a deleted branch
   is acted on. If the surviving side gained something new inside that branch,
   the branch is kept and restored instead.
6. **Additions**: unpaired nodes left over. An unpaired node identical to a
   paired sibling is a duplicate and is left alone and counted, never copied.
   Site-to-browser additions obey `pull` (below).
7. **Edits and moves** of pairs both sides still have: whichever side differs
   from the base wins; if both do, the site wins.
8. **Order**: per folder, whichever side's order changed since the base wins;
   the other side's new items are slotted in after their neighbours.
9. If the run would remove a lot, it returns `confirm` and nothing has changed.
10. Changes go to the **site first**, as one batch with `baseRev`. If that is
    refused as stale, nothing has been touched and the run starts over.
11. Then the browser. Each change is tried on its own; failures are collected.
12. Both trees are read again and the new base is whatever the two sides
    actually agree on. Where they still differ, the old base is kept, so the
    next run sees the same difference and tries again.

### Not doubling bookmarks (`pull`)

With two browsers on Vivaldi Sync, a bookmark that both bridges add locally is
delivered by Vivaldi Sync as two bookmarks on both machines. So:

- The server stamps every node a bridge creates with that bridge's id
  (`origin`). Nodes made on the site have none.
- `POST /api/bridge/lease` gives one bridge at a time the job of adding. It
  passes on if the holder hasn't asked for a day, or is unlinked.
- The lease holder runs with `pull: 'site'`: it adds nodes with no origin, and
  leaves nodes another linked bridge made, because that browser's own sync is
  already carrying them. Everyone else runs with `pull: 'none'` and adds
  nothing. Both then recognise the bookmark by content when Vivaldi Sync
  delivers it. A browser marked "doesn't share with my other browsers" runs
  with `pull: 'all'`.
- Edits, moves and deletions from the site are applied by every bridge; doing
  the same edit to the same synced bookmark twice is harmless.
- If doubles do appear (the lease changed hands at a bad moment), the spare
  copies are left alone and reported, never copied to the site, and never
  removed automatically: two browsers each removing "the spare" can remove
  both. Deleting a spare by hand in one browser is safe.

### The worker (`src/bridge/background.ts`)

- Nothing is kept in memory between events; state is in `chrome.storage.local`
  (`link`, `prefs`, `status`, `state`, `dirty`, `rev`, `redirect`).
- A bookmark event marks the browser dirty and syncs four seconds later. An
  alarm every minute asks the site whether its `rev` moved. A full comparison
  runs at least every 15 minutes regardless.
- The site address is not in the manifest. `optional_host_permissions` plus a
  permission request at link time grants access to just that one origin.
- The new-tab page reads `redirect` from storage and goes to the site only
  while the worker last found it answering; otherwise the built-in page shows.

## Known gaps and ideas

- Real Vivaldi has only been tried headless with a throwaway profile, never
  with two machines on Vivaldi Sync (see CLAUDE.md, "Where things stand").
- Two sibling folders with the same name in one parent: the second is treated
  as a duplicate and its contents are not synced.
- Each open tab of the site holds one event stream. Over HTTP/1.1 a browser
  allows six connections per site, so the proxy should serve HTTP/2; closing
  the stream while a tab is hidden would remove the dependency.
- Settings are shared by every device (a phone and a desktop share one card
  layout). Per-device settings would need the settings bookmark split.
- No alerting when an app goes down; the data (`incidents`) is there for it.
- Site icons come from Google's favicon service, so it sees the bookmarked
  domains. The extension build still uses the browser's own cache.
