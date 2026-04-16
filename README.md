# mdee

Terminal Markdown reader and editor: rendered preview with Tree-sitter highlighting, optional plain-text edit mode, and save to disk. Built with [Bun](https://bun.com) and [OpenTUI](https://github.com/sst/opentui).

## Requirements

- [Bun](https://bun.com) (the CLI is a Bun script)

## Install from this repo

```bash
bun install
bun link          # optional: adds `mdee` to your PATH
```

## Usage

```bash
mdee path/to/file.md
# or, without linking:
bun src/index.ts path/to/file.md
```

The file must already exist. The window title is set to the file’s basename.

## Keys

| Key | Action |
| --- | --- |
| `i` | Enter **edit** mode (plain text; preview is hidden) |
| `Esc` | Leave edit mode (buffer is applied to the preview) |
| `Ctrl+S` / `Cmd+S` | Save to the file on disk |
| `q` | Quit (prompts if there are unsaved changes) |
| `Ctrl+C` | Same quit flow as `q` |

When the quit prompt is open: **Y** save and exit, **N** discard and exit, **Esc** cancel.

Mouse scrolling is enabled in view mode where the terminal supports it.

## Remote install (optional)

The project site is [mdee.bkh.dev](https://mdee.bkh.dev). The repo root `install` script downloads the full installer from `https://mdee.bkh.dev/install` and runs it. Set `MDEE_INSTALL_URL` to another URL (for example a `raw.githubusercontent.com` link to your fork) if you do not use that host.

## Develop

```bash
bun install
bun src/index.ts sample.md
```

Static landing page and installer sources live under `web/`.
