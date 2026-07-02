# Basalt

A beautiful Android app for your markdown vault — Obsidian's feel, GitJournal's data model. Your notes stay plain markdown files in a normal git repository, synced with GitHub. No lock-in, ever.

## What it does

- **Reads and edits an Obsidian-style vault**: wikilinks, `![[embeds]]`, callouts, tags, tasks, frontmatter, code highlighting, tables, images.
- **Syncs via git**: auto-commit on edit, auto-pull on open, push after a quiet period. Offline-first — everything works without a connection and syncs when you're back.
- **Never loses data**: real merge conflicts keep both versions (your phone's copy is saved as `Note (conflict …).md`), and the on-device vault is a normal git working tree you can always recover with plain git.
- **Feels native**: dark-first design, hardware back button, fast search, quick open, CodeMirror 6 editor with `[[` autocomplete.

## Architecture

```
React + TypeScript UI (webview)
  CodeMirror 6 editor · remark/rehype renderer
────────────────────────────────────────────
Services (TS): VaultService (files → tree/index/search)
               SyncService  (commit → fetch → merge → push)
────────────────────────────────────────────
GitEngine interface (TS)
  ├─ browser: mock engine + in-memory FS (dev, demo)
  └─ device:  BasaltGit Capacitor plugin (Kotlin + JGit)
────────────────────────────────────────────
Vault = a plain git working tree in app storage
```

The UI never talks to git directly. The `GitEngine` interface (`src/engine/types.ts`) is the only doorway; on Android it's implemented by a Capacitor plugin wrapping **JGit** (`android/.../BasaltGitPlugin.java`) — clone, fetch, three-way merge, push, log — with the GitHub token in Android-Keystore-backed storage.

## Development

```bash
npm install
npm run dev        # browser dev with mock git engine + demo vault
npm test           # vitest unit tests (domain layer)
npm run build      # typecheck + production bundle
```

## Android

```bash
npm run build
npx cap sync android
cd android && JAVA_HOME=<jdk21> ./gradlew assembleDebug
adb install app/build/outputs/apk/debug/app-debug.apk
```

## Setup on the phone

1. Create a **fine-grained personal access token** on GitHub scoped to your vault repo (Contents: read & write).
2. Open Basalt → Connect a repository → paste `owner/repo` + token.
3. Pick a branch. The vault clones and you're in.
