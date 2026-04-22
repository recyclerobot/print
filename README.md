# Print — WebGL InDesign-style print designer

A static, single-page web app built with **Vite + TypeScript** that runs a full-page **WebGL2** canvas as an InDesign-style page layout tool. Documents are stored in your browser's `localStorage` — no server, no accounts.

## Features

- **WebGL2 full-page canvas** — page, bleed, margins, grid, multi-element rendering with rotation and opacity, retina-aware.
- **Print sizes in cm** — pick A3/A4/A5/A6/Letter/Legal/Postcard or enter custom width/height.
- **Pages & templates** — add/remove/reorder pages; save the current page as a reusable template; spawn new pages from any template.
- **Text, images, rectangles** — drag, resize (corner handles, Shift = aspect lock), rotate, lock, hide, layer order.
- **Advanced typography** — font family, weight, italic, size in pt, line height, em letter-spacing/tracking, horizontal align (left/center/right/**justify**), vertical align (top/middle/bottom), color.
- **Rulers + snapping** — top/left rulers in mm/cm/in/pt that follow pan & zoom; smart snapping to page edges, page center, margins, and other elements; nudge with arrows (Shift = 5mm).
- **Margins & bleed** — independent top/right/bottom/left controls, on-canvas guides.
- **Print preview** — render every page in a new window using the browser's print dialog.
- **PDF export** at **72 / 150 / 300 / 600 / 1200 DPI** with bleed and crop marks.
- **Undo / redo** (Ctrl/Cmd+Z, Shift+Z), **fit to screen** (Ctrl/Cmd+0), **zoom** (Ctrl/Cmd+wheel), **pan** (middle-click or Alt+drag).
- **Auto-saved** to `localStorage` on every change.

## Getting started

```sh
npm install
npm run dev    # http://localhost:5173
```

## Build & GitHub Pages deploy

This project builds **directly into `docs/`** so you can serve from `main:/docs` on GitHub Pages.

```sh
npm run build
```

Vite is configured with `emptyOutDir: false`, and the included pre-commit hook explicitly **preserves `docs/CNAME`** (snapshot before build, restore after, then `git add docs`). To enable the hook locally:

```sh
npm install            # runs `husky` via the prepare script
chmod +x .husky/pre-commit
```

To set up GitHub Pages:

1. Create a `docs/CNAME` file containing your custom domain (or skip if using `*.github.io`).
2. In repo Settings → Pages, choose **Deploy from a branch**, branch `main`, folder `/docs`.
3. Commit — the pre-commit hook builds the site, restores `CNAME`, and stages everything.

## Keyboard shortcuts

| Action                  | Shortcut                       |
| ----------------------- | ------------------------------ |
| Undo / Redo             | Ctrl/Cmd+Z, Ctrl/Cmd+Shift+Z   |
| Delete selection        | Backspace / Delete             |
| Nudge / large nudge     | Arrow keys / Shift+Arrows      |
| Pan                     | Middle-click drag, or Alt+drag |
| Zoom                    | Ctrl/Cmd + scroll              |
| Fit to screen           | Ctrl/Cmd+0                     |
| Constrain resize aspect | Shift while resizing           |

## How it works

- All measurements are stored in **mm**; UI converts to/from the user's chosen unit (cm/mm/in/pt).
- Each element is rasterized to an offscreen 2D canvas at the current zoom level (re-rasterized when properties change or zoom changes by >25%) and uploaded to a WebGL2 texture; the renderer draws textured quads with a per-element world matrix and a shared view matrix.
- Print/PDF export skips the WebGL path and rasterizes to a 2D canvas at the requested DPI, then embeds the JPEG into a `jspdf` page sized in mm (with optional bleed and crop marks).
