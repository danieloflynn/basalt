/** Seed content for the browser mock engine — exercises every rendering feature. */
export const DEMO_VAULT: Record<string, string> = {
  'Welcome.md': `---
title: Welcome
tags: [basalt, demo]
created: 2026-07-02
---

# Welcome to Basalt

This is the **browser demo vault** — on your phone this is your real repo.

Basalt keeps your vault as plain markdown files in a normal git working
tree, synced with GitHub. No lock-in, ever.

## Try things

- Open the [[Projects/Basalt|Basalt project note]]
- A daily note: [[2026-07-02]]
- Check tasks below

## Tasks

- [x] Clone the vault
- [ ] Read [[Reading List]]
- [ ] Go for a run #health

> [!tip] Callouts work
> Obsidian-style callouts render natively.

A little code:

\`\`\`ts
export function hello(name: string): string {
  return \`Hello, \${name}!\`;
}
\`\`\`

| Feature | Status |
| ------- | ------ |
| Wikilinks | ✅ |
| Sync | ✅ |
`,
  'Reading List.md': `---
tags: [reading]
---

# Reading List

- *The Design of Everyday Things* — Don Norman
- *A Philosophy of Software Design* — John Ousterhout

See also [[Welcome]] and ![[Projects/Basalt#Why]] embeds.
`,
  '2026-07-02.md': `# 2026-07-02

Started building **Basalt** today. Notes sync via git — see [[Projects/Basalt]].

- [ ] Ship the sync engine #basalt
`,
  'Projects/Basalt.md': `---
tags: [basalt, project]
status: active
---

# Basalt

A beautiful Android markdown vault synced with GitHub.

## Why

Obsidian's feel, GitJournal's data model: plain files in a git repo.

## Architecture

1. React + TypeScript UI in a Capacitor shell
2. CodeMirror 6 editor
3. JGit sync engine (Kotlin plugin)

![remote image](https://raw.githubusercontent.com/github/explore/main/topics/markdown/markdown.png)

> [!warning] Data safety
> Conflicts never lose data — the local version is kept as a conflict copy.
`,
  'Projects/Someday.md': `# Someday

- Mermaid diagrams
- LaTeX math
- iOS build
`,
  'Archive/Old Note.md': `# Old Note

This note lives in the archive. It links back to [[Welcome]].
`,
};
