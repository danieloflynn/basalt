# Basalt — working notes

Android markdown vault app (Obsidian feel, GitJournal data model, GitHub sync).
React 19 + TS strict + Vite in a Capacitor 8 shell; git via a Java JGit plugin.

**Layout = Obsidian mobile, by explicit user request** (see screenshots in the
first session): left sidebar overlay with Files/Search/Tags/Properties/Bookmarks
views + view-switcher pill + vault bar (name → vault menu, sync columns, gear);
note-first workspace with sidebar toggle top-left and edit-toggle + ⋮ menu
top-right; floating bottom pill (back/forward/quick-open/new/tabs/palette).
Navigation is per-tab history with back AND forward (`src/state/nav.ts`).

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
