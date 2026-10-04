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
