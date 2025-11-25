# Quick Open Commands (Obsidian community plugin)

Adds quick commands that open frequently used markdown files in your vault. Commands are manageable from the plugin settings tab and appear in the command palette so you can bind shortcuts.

## Features
- Add/remove commands that open specific files
- Commands show in command palette and can be assigned hotkeys
- File-existence warning in settings
- Search/filter commands when 5+ items exist

## Development

Prerequisites:
- Node.js (recommended v16+)

Install dev dependencies and build:

```powershell
npm install
npm run build
```

After `npm run build`, copy the plugin folder (the files `manifest.json`, `main.js`, and `README.md`) into your Obsidian vault plugin folder (e.g. `.obsidian/plugins/quick-open-commands`) and enable the plugin in Obsidian.

## Notes
- This repository uses `esbuild` to bundle `src/main.ts` into `main.js` for Obsidian.
- If you need a development hot-reload setup, I can add a watch-builder or the official community plugin template flow.
