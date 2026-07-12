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
- An HTML artifact: [[Sync Pulse.html|Sync Pulse]]
- Check tasks below

## Tasks

- [x] Clone the vault
- [ ] Read [[Reading List]]
- [ ] Go for a run #health

> [!tip] Callouts work
> Callouts render natively.

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

Started building **Basalt** today. Notes sync via git — see [[Projects/Basalt#Architecture]].

- [ ] Ship the sync engine #basalt
`,
  'Projects/Basalt.md': `---
tags: [basalt, project]
status: active
---

# Basalt

A beautiful Android markdown vault synced with GitHub.

## Why

Plain files in a git repo — your notes stay yours.

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
  'Projects/Showcase.md': `---
tags: [demo]
status: draft
---

Everything in one note. ==Highlights render== like this.
%%This comment is invisible in reading view.%%

Jump within this note: [[#Math]] · [[#Diagrams]].

A block reference lives here — the key insight of the whole project. ^key-idea

Embedded block: ![[Showcase#^key-idea]]

## Math

Inline $E = mc^2$ and display:

$$\\int_0^\\infty e^{-x^2}\\,dx = \\frac{\\sqrt{\\pi}}{2}$$

## Diagrams

\`\`\`mermaid
graph LR
  A[Phone] -->|push| B(GitHub)
  B -->|pull| C[Desktop]
  C -->|push| B
  B -->|pull| A
\`\`\`

> [!tip]- Folded callout
> This callout starts collapsed — tap to open.

A link to a note that doesn't exist yet renders muted: [[Future Idea]].

## HTML artifacts

An .html file in the vault renders sandboxed, scripts and all:

![[Sync Pulse.html]]
`,
  'templates/Meeting.md': `# {{title}}

Date: {{date}} {{time}}

## Agenda

-

## Notes

`,
  'Artifacts/Sync Pulse.html': `<!doctype html>
<html>
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Sync Pulse</title>
<style>
  :root { color-scheme: dark; }
  body { margin: 0; padding: 24px; font-family: system-ui, sans-serif; background: #131215; color: #e8e6e3; }
  h1 { font-size: 20px; margin: 0 0 4px; }
  p { margin: 0 0 20px; font-size: 13px; color: #9b978f; }
  .cols { display: flex; gap: 10px; align-items: flex-end; height: 120px; margin-bottom: 20px; }
  .col { flex: 1; border-radius: 6px 6px 2px 2px; background: linear-gradient(180deg, #ff6a2b, #b23a10); transition: height 0.3s ease; }
  button { border: none; border-radius: 999px; padding: 10px 18px; font-size: 14px; font-weight: 600; background: #ff6a2b; color: #131215; }
  #count { font-variant-numeric: tabular-nums; }
  .foot { margin-top: 24px; font-size: 12px; color: #6f6b64; }
  .foot a { color: #8fbfa5; }
</style>
</head>
<body>
  <h1>Sync Pulse</h1>
  <p>A self-contained HTML artifact living in the vault, rendered in a sandbox.</p>
  <div class="cols" id="cols"></div>
  <button id="pulse">Pulse <span id="count">0</span></button>
  <!-- Vault links (they show up in the graph): <a href="Welcome.md"> and [[Reading List]] -->
  <p class="foot">Part of the <a href="Welcome.md">Welcome</a> tour.</p>
  <script>
    var heights = [42, 78, 56, 96];
    var cols = document.getElementById('cols');
    heights.forEach(function (h) {
      var d = document.createElement('div');
      d.className = 'col';
      d.style.height = h + '%';
      cols.appendChild(d);
    });
    var n = 0;
    document.getElementById('pulse').addEventListener('click', function () {
      n += 1;
      document.getElementById('count').textContent = String(n);
      Array.prototype.forEach.call(cols.children, function (c, i) {
        c.style.height = (30 + ((n * 17 + i * 23) % 70)) + '%';
      });
    });
  </script>
</body>
</html>
`,
  '.obsidian/daily-notes.json': `{"folder": "Daily", "format": "YYYY-MM-DD"}`,
  'Daily/2026-07-01.md': `# 2026-07-01

Yesterday's note. Tomorrow: [[2026-07-02]]. #daily
`,
};
