# Basalt — working notes

Android markdown vault app (Obsidian feel, GitJournal data model, GitHub sync).
React 19 + TS strict + Vite in a Capacitor 8 shell; git via a Kotlin JGit plugin.

## Commands

- `npm run dev` — browser dev (mock git engine + demo vault auto-loads after fake onboarding)
- `npm test` — vitest (domain layer tests in `src/lib/lib.test.ts`)
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
