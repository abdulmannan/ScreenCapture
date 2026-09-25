# Chrome Web Store listing: copy and paste

## Store listing tab

**Name:** Screen Capture (taken from the manifest)

**Summary** (taken from the manifest description, 132 characters max):
Screenshot the full contents of a scrollable element (chat panes, code blocks, data grids) instead of the whole page.

**Category:** Tools

**Language:** English

**Description:**

```
Capture everything inside a scrollable area, not just the part you can see.

Chat conversations, long code blocks, data tables, log viewers and sidebars often scroll inside the page, so normal full-page screenshots miss most of their content. Screen Capture scrolls through the area you pick and stitches it into a single tall image.

HOW IT WORKS
1. Click the Screen Capture icon, then "Pick element to capture".
2. Move your mouse over the page. Scrollable areas are highlighted.
3. Click the one you want. Screen Capture scrolls through it and captures every part.
4. A preview opens in a new tab, where you can copy the image, download it, or save it wherever you like.

FEATURES
• Works with Windows display scaling and high-DPI screens
• Hides sticky and fixed headers inside the area so they don't repeat in the image
• Handles lazily loaded lists (chat apps, virtualized grids), with an adjustable delay in Settings
• Puts the page's scroll position back when it's done
• Press Esc at any time to cancel

PRIVACY
Everything happens on your computer. Screen Capture collects no data, has no tracking, and makes no network requests.

KNOWN LIMITATIONS
• Scroll areas inside embedded frames (iframes) aren't supported.
• Very long areas take a while, because Chrome allows only about 2 screenshots per second.
• It can't run on Chrome's own pages (chrome://) or on the Chrome Web Store.

This extension is provided "as is", without warranty of any kind. Use it at your own risk.
```

**Graphic assets:**
- Store icon (128×128): `icons/icon128.png`
- Small promo tile (440×280): `store/promo-small-440x280.png`
- Screenshots (1280×800 or 640×400, at least 1): take these yourself. Good ones to show:
  1. Picker mode, with the pink highlight and label on a chat pane
  2. The preview tab showing a tall stitched capture
  3. The settings page

## Privacy tab

**Single purpose description:**

```
Screen Capture takes a screenshot of the full contents of a single scrollable element on a web page that the user selects, and shows it in a preview where the user can copy or download it.
```

**Permission justifications:**

| Permission | Justification |
| --- | --- |
| activeTab | Needed to capture screenshots (chrome.tabs.captureVisibleTab) of the current tab, and only after the user clicks the extension's toolbar button and starts a capture. |
| scripting | Adds the element picker and capture script to the current tab when the user clicks "Pick element to capture". Nothing is injected automatically. |
| downloads | Saves the captured image to the user's computer when they click Download or Save as in the preview tab. |

**Remote code:** No, I am not using remote code. All JavaScript is included in the package.

**Data usage:** leave every data type unchecked. The extension collects no user data. Tick all three certifications:
- I do not sell or transfer user data to third parties, outside of the approved use cases
- I do not use or transfer user data for purposes that are unrelated to my item's single purpose
- I do not use or transfer user data to determine creditworthiness or for lending purposes

**Privacy policy URL:** the public URL where you host `PRIVACY.md` (see the README).

## Distribution tab

- **Payments:** Free of charge
- **Visibility:** Unlisted
- **Distribution:** All regions
