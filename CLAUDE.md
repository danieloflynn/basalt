# Basalt — working notes

Android markdown vault app (Obsidian feel, GitJournal data model, GitHub sync).
React 19 + TS strict + Vite in a Capacitor 8 shell; git via a Java JGit plugin.

**Layout = Obsidian mobile, by explicit user request** (see screenshots in the
first session): left sidebar overlay with Files/Search/Tags/Properties/Bookmarks
views + view-switcher pill + vault bar (name → vault menu, sync columns, gear);
note-first workspace with sidebar toggle top-left and edit-toggle + ⋮ menu
top-right; floating bottom pill (back/forward/quick-open/new/tabs/palette).
Navigation is per-tab history with back AND forward (`src/state/nav.ts`).

## Git workflow

**Standing authorization (overrides the default "commit/push only when asked"):**
in this repo you may commit AND push without pausing for per-action approval —
treat it as pre-approved. Keep branching off `main` for feature work rather than
committing straight to `main`, and still follow the repo's commit conventions
(explicit staging so `bug notes.md` and session `.txt` exports stay untracked;
`Co-Authored-By: Claude Fable 5` + `Claude-Session:` trailer).

## Commands

- `npm run dev` — browser dev (mock git engine + demo vault auto-loads after fake onboarding)
- `npm test` — vitest (domain layer: `src/lib/lib.test.ts`, `src/state/nav.test.ts`)
- `npm run test:visual` — Playwright suite (`tests/visual/`): screenshot specs
  (`visual.spec.ts`), gestures (drawers, pull-down, DnD in `gestures.spec.ts` /
  `dnd.spec.ts`), integration flows (`flows.spec.ts` creation+rename+templates,
  `editor.spec.ts` live-preview/mode, `toolbar.spec.ts`, `graph.spec.ts`).
  Retries are 0 on purpose — a flaky test is a bug; fix the wait, don't retry.
  Baselines in `tests/visual/__screenshots__` are committed. After an intentional UI change
  run `npm run test:visual:update` and eyeball the changed PNGs. Beware: a
  small text change can sit inside the 0.002 diff tolerance, so
  `--update-snapshots` won't rewrite the PNG — delete the stale baseline to
  force regeneration.
- `npm run build` — `tsc --noEmit` then vite build (keep it green)
- `npm run sync` — build + `cap sync android`
- `npm run electron:dev` — bundle main/preload, then launch Electron against the
  running vite dev server (start `npm run dev` first). `electron:build` =
  renderer build + `tsc -p electron` + esbuild bundle; `electron:pack` = that,
  then an unsigned **x64** `.dmg` in `release/` (Daniel's Mac is Intel — a
  Core i5; an arm64 build gives "not supported on this Mac". Switch to `--arm64`
  or `--universal` only if the target machine changes). Electron main/preload are
  typechecked by `electron/tsconfig.json` (separate from the renderer's `tsc`).
- Android build: `cd android && JAVA_HOME=$HOME/.local/java/jdk-21.0.11+10/Contents/Home ./gradlew assembleDebug`
  (JDK 21 required; system JDK 26 is too new for AGP. SDK path in `android/local.properties`.)

## Architecture rules

- **UI never touches git or the filesystem directly.** Everything goes through
  `src/services/vault.ts` (files, tree, search index) and `src/services/sync.ts`
  (commit→fetch→merge→push state machine). Those drive `src/engine/` — the
  `GitEngine`/`VaultFS` interfaces with native (Capacitor plugin) and mock
  (in-memory, browser dev) implementations chosen in `src/engine/index.ts`.
- **Files are the source of truth.** The minisearch index, tree, and link
  resolver are derived caches; anything persistent must round-trip through
  markdown on disk, byte-compatible with desktop Obsidian.
- **Conflicts never lose data** (core promise): JGit merge keeps remote version
  under the original name, local version as `Name (conflict …).md` — see
  `resolveConflictsKeepingBoth` in `BasaltGitPlugin.java`.
- Vault paths are vault-relative, forward slashes, no leading/trailing `/`
  (`src/lib/paths.ts` helpers).

## Desktop (Mac / Electron)

Basalt also runs as a macOS app. It reuses the SAME `src/` renderer and the SAME
`dist/` bundle — the web/Android pipeline is untouched. The desktop target is a
**third implementation of the `GitEngine`/`VaultFS` seam** (`src/engine/desktop.ts`),
nothing more: those adapters marshal every call over a typed `window.basalt` IPC
bridge to an Electron main process, where isomorphic-git + Node `fs` + macOS
Keychain do the real work. Do NOT let desktop code leak past this seam into UI
components.

- **Layout.** The three-pane desktop chrome (docked file tree ▸ note ▸ backlinks,
  tab strip) is pure CSS, gated on `.shell[data-desktop]` (viewport `min-width:960px`
  via `useIsDesktop`). It is independent of Electron — it also shows in a wide
  browser. Electron presence is a SEPARATE signal (`html.is-electron`, set by the
  preload) used only for the traffic-light inset. Don't conflate the two.
- **Engine selection order** (`src/engine/index.ts`): `isDesktopPlatform` (=`!!window.basalt`)
  is checked BEFORE the Capacitor native check, because Electron reports as a
  non-native web platform. The preload injects `window.basalt` before any renderer
  module runs, so the module-load-time check is safe.
- **The bridge contract is one file:** `src/engine/bridge.ts` (`BasaltBridge`).
  Renderer `desktop.ts`, preload, and every `ipcMain.handle` in `electron/main.ts`
  must stay in lockstep with it. fs methods are positional (`dir, path, …`); git
  methods take a single opts object. `electron/ipc.ts` holds the channel names.
- **Security invariants (do not weaken):** `contextIsolation:true`,
  `nodeIntegration:false`; the renderer never touches fs/git directly. `vaultRoot(dir)`
  in main.ts accepts EXACTLY two shapes (logic + tests in
  `electron/services/externalVaults.ts`): a relative name that is a strict child
  of `userData/vaults` (a `..` would let `deleteRepo`'s recursive rm escape), or
  an absolute path that EXACTLY matches the external-vault registry
  (`userData/external-vaults.json`) — which only the main-process folder-picker
  dialog ("Open a folder as vault") ever appends to, so the renderer can never
  name new paths into existence. `deleteRepo` on an external vault only
  deregisters it; it NEVER recursively deletes a user folder. `safeJoin`/protocol
  handlers guard the leaf path with `abs.startsWith(root + sep)`; the
  `basalt-file://` host carries the vault dir hex-encoded (URL hosts are
  lowercased — a raw absolute path would corrupt). A `will-navigate` handler locks
  top-level nav to `app://`/dev-URL (origin-compared, so a dev reload's trailing
  slash still counts as internal) so the privileged bridge can't ride into a
  remote origin (external links → `shell.openExternal`). The PAT is stored ONLY via
  `safeStorage` (Keychain); `setCredentials` REFUSES to persist if encryption is
  unavailable rather than fall back to plaintext. **Symlink guards** (a synced repo
  can commit a symlink): the merge writer refuses to write through any symlink on
  the target path (`assertNoSymlinkOnPath`, the analogue of isomorphic-git's own
  `assertNoSymlinkInLeadingPath`), and the `basalt-file://` handler `realpath`s the
  target and re-checks vault containment so a vault symlink can't stream out-of-vault
  bytes to the webview. Don't remove these when touching the write/serve paths.
- **Folder vaults & sync modes (desktop).** "Open a folder as vault" (onboarding
  welcome + vault menu, gated on `isDesktopPlatform`) opens any disk folder via
  the flow in `src/ui/screens/OpenFolderVault.tsx`. Per-vault
  `VaultInfo.mode: 'git' | 'local'` (absent = git): 'local' means Basalt ONLY
  reads/writes files — SyncService no-ops (guards in notifyEdit/syncNow), the
  vault-bar sync button hides, settings shows a local-only note, and it never
  runs `git init` behind the user's back (repo-less folders are always local).
  External GIT vaults fetch/push through the **system git CLI**
  (`NetCtx.preferCli`, set in main.ts when the dir is external) so the user's
  own credentials apply — ssh keys and credential helpers — with
  `GIT_TERMINAL_PROMPT=0` + ssh BatchMode so a missing login fails fast instead
  of hanging; commit identity prefers the repo's `git config user.name/email`
  over Basalt defaults. Managed (app-cloned) vaults keep the isomorphic-git +
  Keychain-PAT flow untouched; local ops (status/commit/merge) stay
  isomorphic-git everywhere. CLI path tested against a `file://` bare remote in
  `electron/git/engine.cli.node.test.ts`.
- **`electron/git/engine.ts` mirrors the JGit plugin's "never lose data" promise.**
  Same content-hash status (`changesVsHead` re-hashes each `.gitignore`-enumerated
  path, so a same-size/same-mtime edit isn't missed) and same conflict-keep-both
  merge (remote keeps the name, local → `Name (conflict …).ext`). **`merge()`
  commits any uncommitted working-tree change FIRST**, before its force-checkout —
  an autosave can land between sync's `commitAll` and `merge` (fetch is slow; the
  push-retry loop re-enters merge without re-committing), and the force-checkout
  would otherwise silently revert it. Regression test in `engine.node.test.ts`
  ("UNCOMMITTED local edit present at merge time"). The decision-apply + commit is
  wrapped so ANY mid-apply throw (e.g. a file⇄dir name swap's ENOTDIR, or the
  symlink guard) rolls the tree back to a clean `ours` and rethrows — a failed
  merge never leaves a half-applied tree the next sync would commit as corruption.
  This engine is Electron-free on purpose so the merge logic is unit-testable in
  plain Node (`// @vitest-environment node`).
- **Packaging:** main/preload bundle to `electron-dist/*.cjs` (esbuild). `.cjs` is
  deliberate — the root package.json is `"type":"module"`, so a bare `.js` would be
  parsed as ESM and break `require`; `.cjs` also sidesteps Electron's ESM-preload
  restrictions. `main` field points at `electron-dist/main.cjs`; the preload path is
  `preload.cjs`. `app://bundle/index.html` serves `dist/` (vite `base` stays `/`, so
  absolute `/assets` paths resolve). `npm run electron:pack` builds an unsigned
  **x64** `.dmg` (Daniel's Mac is Intel). Build output (`electron-dist/`,
  `release/`) is gitignored. **App icon:** source of truth is `build/icon.svg` (the four
  molten-capped basalt columns — the sync-indicator signature, basalt-black +
  ember); regenerate `build/icon.icns` with
  `rsvg-convert` into an `.iconset` then `iconutil -c icns` (both committed;
  wired via electron-builder `mac.icon`).
- **Reviewed (Opus + Fable adversarial passes).** Verified safe, no change needed:
  a `.gitignore`'d edit is NOT lost on merge — isomorphic-git's force-checkout
  preserves ignored/untracked files (tested empirically). Known deferred (low): a
  file↔directory name swap still wedges the merge (now aborts CLEANLY per the
  safe-abort above — no corruption/data loss, just a sync error until the user
  renames the local file); `fetch()` ahead/behind caps at `depth:500` (cosmetic
  counts only). The symlink findings above were rated reachable only by an untrusted
  repo (Basalt syncs your own single-author vault) but are fixed regardless.

## Design system

Tokens in `src/styles/tokens.css` (`data-theme` on `<html>`, dark default).
Palette: near-black basalt bg, `--ember` (molten orange) for actions/sync
activity, `--link` celadon green for wikilinks/tags. Display font Fraunces,
UI Inter, mono JetBrains Mono. Signature element: the four-column basalt
sync indicator (`.sync-columns`) that glows ember while syncing.

## Gotchas

- TS 6: no `baseUrl` (use relative `paths`); side-effect font imports need `/index.css`.
- `@capacitor/filesystem` `Directory.Data` == Android `filesDir`; the git plugin
  resolves `dir` against `filesDir` too — they must stay in agreement.
- The Kotlin plugin serializes all git ops on one executor; never call it from
  two places expecting parallelism.
- Task checkbox toggling maps rendered-line → source-line via node positions;
  frontmatter offset is added in `NoteScreen` (`fmLineOffset`).
- Touch gestures: pure math in `src/lib/gesture.ts` (unit-tested), DOM layer in
  `src/ui/workspace/DrawerGestures.tsx` — a side-agnostic `installDrawer(side)`
  instantiated for the LEFT (files) and RIGHT (backlinks) drawers. BOTH drawers
  are ALWAYS mounted — `data-open` drives CSS transitions, drags scrub the
  transform inline. Don't go back to conditional mounting. The settle path is
  deliberately synchronous (flushSync, rAF cancelled, no timers) — drags used
  to strand the drawer halfway; see the regression tests in gestures.spec.ts
  before touching it.
- View mode is GLOBAL (`nav.viewMode`, Obsidian's universal reading/editing
  toggle): `push()` reroutes note opens to the editor when 'editing'; persisted
  as `defaultView` in settings, hydrated in App.tsx. Explicit `edit` pushes
  (new-note flows) bypass it.
- Moving a file = `vaultService.moveFile` (dedupes, rewrites folder-qualified
  inbound wikilinks BEFORE renameFile — same ordering rule as renameByTitle:
  rewrite while the resolver still knows the old path). Tree drag-and-drop in
  Sidebar.tsx: press-and-hold-then-move drags (sets `data-tree-drag` on <html>,
  which the drawer gesture layer treats as a claim); press-and-release still
  opens the file actions sheet.
- Edit screen: the format toolbar renders only while the editor has focus
  (`nav.editorFocused`), and the bottom pill hides then — they share the same
  bottom space and used to collide.
- **The inline title IS the filename** (Obsidian model): `InlineTitle.tsx` in
  both screens commits via `vaultService.renameByTitle` (sanitize, dedupe,
  vault-wide `[[wikilink]]` rewrite, bookmark migration) + `nav.renamePath`
  (rewrites every tab's history). Note creation is dialog-free everywhere —
  fresh empty `Untitled( N)` notes autofocus the title in the editor. Don't
  reintroduce name dialogs.
- App.tsx keys screens on `screen.path`, so a rename remounts the current
  screen. EditScreen survives this via `pathRef` (saves always target the
  current path; flush-before-rename; a stale flush skips paths no longer in
  the vault). Keep that ordering if you touch autosave.
- `createNote` must add the new note to the MiniSearch index immediately: the
  index is a derived cache and every later op (autosave `replace`, rename
  `discard`) assumes markdown files are in it. Membership checks go through
  `search.has()`, never the notes map (it's rebuilt from file listings and
  lies about index membership).
- **Every mutating vault op is serialized** through an internal lock in
  VaultService (public wrappers acquire it; unlocked `*Impl`/`*Plain` helpers
  call each other — a locked reentrant call deadlocks). `writeNote` is
  write-through (cache updated before the disk write), and `renameFile` throws
  if the destination exists. Don't add a mutating public method without the
  lock, and don't call a public mutator from inside an Impl.
- **UI rename/move goes through the safe APIs only**: `renameByTitle` /
  `moveFile` / `renameFolder` (dedupe + sanitize + vault-wide link rewrite +
  bookmark/recents migration), preceded by `flushActiveEditor()`
  (`src/lib/editorFlush.ts` — EditScreen registers its flush there) and
  followed by `nav.renamePath`. Raw `renameFile` from UI destroyed notes once;
  never again. Titles are sanitized centrally (`sanitizeNoteTitle` in
  paths.ts) — `| # [ ] ^ \ / :` and leading dots corrupt links or hide files.
- Editor frontmatter is a Lezer block parser (`src/ui/editor/frontmatter.ts`)
  that must decide from the raw input BEFORE consuming lines — @lezer/markdown
  never rewinds a false return after nextLine(). Fences are exactly `---`.
- livePreview's regex passes are syntax-tree gated (SKIP_NODES: code,
  frontmatter, math) — any new pass must check `inSkip()` or it will style
  code-fence contents.
- Drawers are FULL-WIDTH when open (no 52px gutter). Graph view: config lives
  in `settings.graph` (`GraphConfig` from `src/ui/graph/config.ts`), pure model
  in `src/ui/graph/model.ts`; tests drive positions via the dev-only
  `window.__graphDebug` hook.
- Templates: folder setting `templateFolder` (default `templates`, matched
  case-sensitively); palette "Insert template" hands off through
  `useTemplateHandoff` (src/ui/templates.ts), drained by an EditScreen effect.
- Note embeds are hoisted out of host paragraphs by `rehypeHoistEmbeds`
  (block cards inside `<p>` are invalid nesting) — media embeds stay inline.
- Checklist behavior lives in `src/lib/tasks.ts` (pure, heavily unit-tested):
  checking a task sinks it below its siblings, unchecking floats it above the
  checked run (`sortCheckedToBottom` setting, default on; reading-view taps in
  NoteScreen, live-preview taps in CheckboxWidget). Two invariants: a no-op
  toggle must NEVER rewrite untouched lines (gap/ordinal normalization only
  happens when something actually moved), and a live-preview tap is ONE
  transaction (sort computed on the would-be text, single dispatch = single
  undo). Group/block boundary rules (thematic breaks, lazy continuations,
  paragraph-interrupting blocks) are encoded in blockEnd — extend there, with
  a regression test per rule.
- HTML artifacts: `.html`/`.htm` vault files are first-class, rendered in a
  srcdoc iframe (`ArtifactFrame`) sandboxed WITHOUT `allow-same-origin` —
  artifact scripts run but can never reach the app, the Capacitor bridge, or
  vault storage. Keep it that way. The ONLY channel out is the injected click
  bridge (`injectArtifactBridge` in `src/lib/artifactLinks.ts`): anchor taps
  postMessage their href to the app, which treats it purely as a link target
  — vault links open in-app, http(s) opens the system browser. Tree rows,
  wikilinks (`[[page.html]]`) and markdown links open the viewer;
  `![[page.html]]` embeds inline (the `data-media` path in `remarkObsidian`).
  Artifacts stay out of the notes map / search index — they're files, not
  notes — but they ARE graph nodes: `<a href>` targets and `[[wikilinks]]`
  in the HTML source become edges, artifact nodes render in the link color,
  and backlinks list artifact sources.
