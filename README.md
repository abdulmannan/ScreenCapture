# ScreenCapture

A Chrome extension (Manifest V3) that screenshots the **full scrollable contents of a single element** on a page, such as a chat pane, a code block or a data grid, rather than the whole page.

## Status

| Stage | State |
| --- | --- |
| Scaffold (manifest, popup, service worker, content script) | Done |
| Picker mode (hover highlight, click to select, Esc to cancel) | Done |
| Capture pipeline (scroll, capture, crop, stitch) | Done |
| Preview tab (copy, download, save as, zoom, discard) | Done |

## Install

1. Open `chrome://extensions`.
2. Turn on **Developer mode** (top-right).
3. Click **Load unpacked** and choose this folder (the one that contains `manifest.json`).
4. Optional: pin the extension from the puzzle-piece menu so you can reach it quickly.

After you edit the source, click the reload icon on the extension's card, then reload the page you're testing on.

### Testing with the bundled page

`test/test-page.html` has a chat pane, a code block, a table with a sticky header, nested scrollers, a virtualized list that renders rows 200 ms after each scroll, and an `overflow: hidden` control. To use it from `file://`, open the extension's **Details** page and turn on **Allow access to file URLs**. You can also serve the folder instead, for example with `npx serve test`.

## Usage

1. Click the extension icon, then click **Pick element to capture**.
2. Move the mouse over the page. The nearest scrollable ancestor of the element under the cursor is highlighted, with its size and estimated frame count.
3. Click to select it, or press **Esc** to cancel.
4. The container scrolls through its content while a small toast shows progress ("Capturing 3/12"). Don't switch tabs while this runs. Press **Esc** to stop at any point.
5. The container's scroll position and styles are put back the way they were, and a **preview tab** opens next to the page. From there you can:
   - **Copy** the image to the clipboard.
   - **Download** it as `screencapture_YYYY-MM-DD_HH-MM-SS.png`, or use **Save as…** to choose a location.
   - Switch between **Fit to window** and **Actual size**, by clicking the image or using the button.
   - **Discard** the capture, which deletes it and closes the tab.

The 5 most recent captures are kept in the extension's IndexedDB, so reloading a preview tab still works. Older captures are removed automatically.

### Settings

Open the settings with the gear icon in the popup, or with the extension's **Options** entry on `chrome://extensions`.

**Settle delay** (default 350 ms) is how long the capture waits after each scroll step before taking a screenshot. Raise it for virtualized lists (React Window, chat apps) that render rows lazily. The value is kept in the extension's `localStorage`, which the popup and the settings page share, so the extension doesn't need the `storage` permission.

## How elements are detected

An element counts as scrollable when both of these are true:

- `scrollHeight > clientHeight` (with 1 px of tolerance for subpixel rounding)
- its computed `overflow-y` is `auto`, `scroll` or `overlay`

`<html>` and `<body>` are excluded on purpose, because the page itself is out of scope. Detection crosses open shadow-root boundaries.

## How capture works

1. The extension saves the container's scroll position, the scroll positions of its ancestors, and the inline styles it is about to change. It then sets `scroll-behavior: auto`, `scroll-snap-type: none`, `overflow-anchor: none` and `pointer-events: none` on the container (the last one stops hover effects from appearing in frames), and scrolls it into view if part of it is off screen.
2. It scrolls the container to the top, then moves down one visible height at a time. After each step it waits one animation frame plus the settle delay.
3. Before each frame it hides `position: sticky` and `position: fixed` descendants with `visibility: hidden`, looking for new ones on every frame because virtualized lists add rows as they scroll. It also hides its own toast and waits for the change to be painted.
4. The service worker calls `captureVisibleTab`, with at least 600 ms between calls and retries if Chrome's rate limit is hit. It crops the screenshot to the part of the container that is actually visible: inside the viewport and not hidden by a surrounding element that clips overflow. CSS pixels are multiplied by `devicePixelRatio`.
5. Only rows that haven't been captured yet are kept. The last step usually overlaps the one before it, and only its new rows are used.
6. The crops are stitched on an `OffscreenCanvas`, stored as PNG blobs in IndexedDB, and shown in `preview.html`.
7. A `finally` block always puts back the scroll positions, the inline styles and sticky element visibility, including when the capture fails or is cancelled.

A capture stops cleanly when you press Esc, the tab is hidden or loses focus, the window is minimized, or the container is removed from the page.

## Files

| File | Role |
| --- | --- |
| `manifest.json` | MV3 manifest. Permissions: `activeTab`, `scripting`, `downloads`. |
| `popup.html` / `popup.js` | Start button and settings gear. Injects `content.js` into the active tab. |
| `options.html` / `options.js` | Settings page (settle delay). |
| `settings.js` | Reads and writes settings; shared by the popup and the settings page. |
| `icons/` | Extension icons (16, 32, 48 and 128 px). |
| `package.ps1` | Builds the Chrome Web Store zip in `dist/`. |
| `store/` | Store listing text and the promo tile. Not included in the zip. |
| `content.js` | Picker mode, the overlay and toast (in a shadow root), and control of the capture: scrolling, settling, hiding sticky elements, crop math and restoring state. |
| `background.js` | Service worker. Rate-limited `captureVisibleTab`, cropping, `OffscreenCanvas` stitching, storing the result and opening the preview tab. |
| `preview.html` / `preview.js` | Preview tab: view, copy, download or discard a capture. |
| `db.js` | Small IndexedDB wrapper shared by the service worker and the preview page. |

## Known limitations

- **Cross-origin iframes aren't supported.** The content script runs only in the top frame, so scrollers inside iframes (including same-origin ones, for now) can't be picked.
- **Long containers are slow.** Chrome limits `captureVisibleTab` to about 2 calls per second, so a container 50 viewport-heights tall takes about 25 seconds or more, plus the settle delay for each frame.
- **Restricted pages don't work.** Chrome blocks script injection on `chrome://` pages, the Chrome Web Store and other extensions' pages.
- **Only vertical scrolling is captured.** Content that overflows horizontally is cropped to the visible width.
- **Very tall images are split.** Chrome's canvas limit is 32,767 px per side (and about 268 megapixels in total), so taller results are split into parts (`…_part1ofN.png` and so on). Each part has its own Copy button, because the clipboard holds only one image.
- **Sticky and fixed elements are hidden in every frame**, including the first one. A sticky table header therefore leaves a blank strip at the top of the image instead of appearing once.
- **Overlays outside the container aren't handled.** A fixed page header that sits on top of the container ends up in every frame.
- **Infinite-scroll containers** that load more content when you reach the bottom can keep growing. Capture stops after 1000 frames.
- **Pinch zoom** (not ordinary browser zoom) makes the crop positions wrong.
- **The page must stay visible.** `captureVisibleTab` only sees what is on screen, so switching tabs or minimizing the window during a capture aborts it.

## Publishing

1. Change `version` in `manifest.json`. Every upload to the Chrome Web Store needs a higher version than the last one.
2. Run `powershell -ExecutionPolicy Bypass -File .\package.ps1`. It creates `dist/screencapture-<version>.zip`, which contains only the extension's own files.
3. Upload the zip in the Chrome Web Store Developer Dashboard. The listing text, permission reasons and privacy answers are in `store/listing.md`.

## Privacy

ScreenCapture collects no data. See [PRIVACY.md](PRIVACY.md).

## License and disclaimer

Released under the [MIT License](LICENSE). The software is provided **"as is", without warranty of any kind**, and the authors aren't liable for any claim, damages or other liability arising from its use. Use it at your own risk.
