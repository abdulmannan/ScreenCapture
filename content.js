// Content script for ScreenCapture.
// Injected on demand by popup.js via chrome.scripting.executeScript. The guard
// below makes repeated injections into the same page a no-op.
(() => {
  if (window.__screenCaptureLoaded) return;
  window.__screenCaptureLoaded = true;

  const settings = { settleDelay: 350 };
  let picker = null;   // active picker state, or null
  let busy = false;    // true while a capture is running

  // ---------------------------------------------------------------------------
  // Scrollable-element detection
  // ---------------------------------------------------------------------------

  function isScrollable(el) {
    if (!(el instanceof Element)) return false;
    // The page itself is out of scope: this extension captures inner containers.
    if (el === document.documentElement || el === document.body) return false;
    // 1px tolerance: subpixel layout often makes scrollHeight exceed clientHeight by 1.
    if (el.scrollHeight - el.clientHeight <= 1) return false;
    const overflowY = getComputedStyle(el).overflowY;
    return overflowY === 'auto' || overflowY === 'scroll' || overflowY === 'overlay';
  }

  // Walks up the tree, crossing open shadow-root boundaries.
  function parentOf(el) {
    if (el.parentElement) return el.parentElement;
    const root = el.getRootNode();
    return root instanceof ShadowRoot ? root.host : null;
  }

  function findScrollableAncestor(start) {
    for (let el = start; el; el = parentOf(el)) {
      if (isScrollable(el)) return el;
    }
    return null;
  }

  function describe(el) {
    let s = el.tagName.toLowerCase();
    if (el.id) s += `#${el.id}`;
    const classes = [...el.classList].slice(0, 2);
    if (classes.length) s += `.${classes.join('.')}`;
    return s.length > 60 ? `${s.slice(0, 57)}...` : s;
  }

  // ---------------------------------------------------------------------------
  // Extension UI (overlay, label, toast), isolated from page CSS in a shadow root
  // ---------------------------------------------------------------------------

  const ui = (() => {
    let host = null;
    let els = null;

    function ensure() {
      if (host?.isConnected) return els;
      host = document.createElement('screencapture-ui');
      host.style.cssText = 'all: initial; position: fixed; inset: 0; pointer-events: none; z-index: 2147483647;';
      const root = host.attachShadow({ mode: 'open' });
      root.innerHTML = `
        <style>
          :host { all: initial; }
          .box {
            position: fixed; display: none; box-sizing: border-box;
            border: 2px solid #ff2d78; background: rgba(255, 45, 120, 0.14);
            border-radius: 2px; pointer-events: none;
            transition: top .06s, left .06s, width .06s, height .06s;
          }
          .label {
            position: fixed; display: none; max-width: 90vw;
            padding: 3px 7px; border-radius: 4px;
            background: #ff2d78; color: #fff;
            font: 600 12px/1.3 system-ui, -apple-system, "Segoe UI", sans-serif;
            white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
            pointer-events: none;
          }
          .toast {
            position: fixed; right: 16px; bottom: 16px; display: none;
            max-width: min(420px, calc(100vw - 32px));
            padding: 10px 14px; border-radius: 8px;
            background: rgba(20, 20, 24, 0.92); color: #fff;
            font: 13px/1.4 system-ui, -apple-system, "Segoe UI", sans-serif;
            box-shadow: 0 4px 18px rgba(0, 0, 0, 0.3);
            pointer-events: none;
          }
        </style>
        <div class="box"></div>
        <div class="label"></div>
        <div class="toast"></div>
      `;
      document.documentElement.appendChild(host);
      els = {
        box: root.querySelector('.box'),
        label: root.querySelector('.label'),
        toast: root.querySelector('.toast'),
      };
      return els;
    }

    let toastTimer = 0;

    return {
      highlight(el, text) {
        const { box, label } = ensure();
        if (!el) {
          box.style.display = 'none';
          label.style.display = 'none';
          return;
        }
        const r = el.getBoundingClientRect();
        Object.assign(box.style, {
          display: 'block',
          top: `${r.top}px`, left: `${r.left}px`,
          width: `${r.width}px`, height: `${r.height}px`,
        });
        label.textContent = text;
        label.style.display = 'block';
        // Place label above the box, or inside its top edge if there's no room.
        const labelTop = r.top >= 24 ? r.top - 22 : Math.max(r.top, 0) + 4;
        label.style.top = `${labelTop}px`;
        label.style.left = `${Math.max(r.left, 0) + (r.top >= 24 ? 0 : 4)}px`;
      },

      toast(text, { timeout = 0 } = {}) {
        const { toast } = ensure();
        clearTimeout(toastTimer);
        toast.textContent = text;
        toast.style.display = 'block';
        if (timeout) toastTimer = setTimeout(() => { toast.style.display = 'none'; }, timeout);
      },

      // The capture pipeline hides the whole UI host before each captureVisibleTab
      // so the toast/overlay never end up in the screenshot.
      setVisible(visible) {
        if (host) host.style.visibility = visible ? 'visible' : 'hidden';
      },
    };
  })();

  // ---------------------------------------------------------------------------
  // Picker mode
  // ---------------------------------------------------------------------------

  // Pointer events we swallow so the page doesn't react to picker clicks.
  const BLOCKED_EVENTS = ['pointerdown', 'pointerup', 'mousedown', 'mouseup', 'click', 'dblclick', 'auxclick', 'contextmenu'];

  function startPicker() {
    if (picker) return;

    const cursorStyle = document.createElement('style');
    cursorStyle.textContent = '* { cursor: crosshair !important; }';
    document.documentElement.appendChild(cursorStyle);

    picker = {
      candidate: null,
      lastTarget: null,
      rafId: 0,
      cursorStyle,
    };

    window.addEventListener('mousemove', onMouseMove, true);
    window.addEventListener('keydown', onKeyDown, true);
    window.addEventListener('scroll', scheduleRefresh, true);
    window.addEventListener('resize', scheduleRefresh, true);
    for (const type of BLOCKED_EVENTS) window.addEventListener(type, onPointerEvent, true);

    ui.toast('Hover a scrollable area and click to capture it. Esc to cancel.');
  }

  function stopPicker() {
    if (!picker) return;
    cancelAnimationFrame(picker.rafId);
    picker.cursorStyle.remove();
    window.removeEventListener('mousemove', onMouseMove, true);
    window.removeEventListener('keydown', onKeyDown, true);
    window.removeEventListener('scroll', scheduleRefresh, true);
    window.removeEventListener('resize', scheduleRefresh, true);
    for (const type of BLOCKED_EVENTS) window.removeEventListener(type, onPointerEvent, true);
    ui.highlight(null);
    picker = null;
  }

  function onMouseMove(e) {
    // composedPath()[0] is the real target even inside open shadow roots.
    picker.lastTarget = e.composedPath()[0] ?? e.target;
    scheduleRefresh();
  }

  function scheduleRefresh() {
    if (!picker || picker.rafId) return;
    picker.rafId = requestAnimationFrame(() => {
      picker.rafId = 0;
      refreshHighlight();
    });
  }

  function refreshHighlight() {
    const el = picker.lastTarget ? findScrollableAncestor(picker.lastTarget) : null;
    picker.candidate = el;
    if (!el) {
      ui.highlight(null);
      return;
    }
    const steps = Math.ceil(el.scrollHeight / el.clientHeight);
    ui.highlight(el, `${describe(el)}  ·  ${el.clientWidth}×${el.scrollHeight}px  ·  ~${steps} frames`);
  }

  function onPointerEvent(e) {
    e.preventDefault();
    e.stopPropagation();
    e.stopImmediatePropagation();
    if (e.type !== 'click' || e.button !== 0) return;

    // Resolve from the click target directly in case no mousemove preceded the click.
    const el = findScrollableAncestor(e.composedPath()[0] ?? e.target);
    if (!el) {
      ui.toast('No scrollable element here. Try another area, or Esc to cancel.');
      return;
    }
    stopPicker();
    onElementPicked(el);
  }

  function onKeyDown(e) {
    if (e.key !== 'Escape') return;
    e.preventDefault();
    e.stopPropagation();
    e.stopImmediatePropagation();
    stopPicker();
    ui.toast('Capture cancelled.', { timeout: 1500 });
  }

  // ---------------------------------------------------------------------------
  // Capture pipeline
  //
  // Coordinates: "content y" is a row in the element's full scrollable content
  // (CSS px). Each frame shows content rows [scrollTop + offsetY, + region height).
  // We track how far content has been covered and crop only the new rows from
  // each frame, so overlapping frames (e.g. the final partial step) never
  // duplicate rows. Everything is converted to device px with devicePixelRatio,
  // rounding frame boundaries from the same content-y values so adjacent crops
  // meet exactly even at fractional scaling (125%, 150%, ...).
  // ---------------------------------------------------------------------------

  const MAX_FRAMES = 1000;

  // Inline overrides applied to the container for the duration of a capture.
  const CAPTURE_STYLE_OVERRIDES = {
    'scroll-behavior': 'auto',  // programmatic scrolls must land immediately
    'scroll-snap-type': 'none', // snapping would pull scrollTop off our step grid
    'overflow-anchor': 'none',  // stop the browser shifting scrollTop when content above resizes
    'pointer-events': 'none',   // the cursor stays put while content scrolls under it; no hover styles in frames
  };

  // User input that would move the container while we're stepping through it.
  const SCROLL_INPUT_EVENTS = ['wheel', 'touchmove'];

  class CaptureAbort extends Error {}

  function onElementPicked(el) {
    startCapture(el);
  }

  async function startCapture(el) {
    busy = true;
    const controller = new AbortController();
    const { signal } = controller;
    const abort = (message) => controller.abort(new CaptureAbort(message));

    const onVisibility = () => {
      if (document.visibilityState === 'hidden') abort('the tab was hidden.');
    };
    // blur also fires when focus moves into an iframe on the same page; hasFocus()
    // stays true in that case, so only abort when the page really lost focus.
    const onBlur = () => setTimeout(() => {
      if (!document.hasFocus()) abort('the tab lost focus.');
    }, 0);
    const onKeyDown = (e) => {
      if (e.key !== 'Escape') return;
      e.preventDefault();
      e.stopImmediatePropagation();
      abort('cancelled.');
    };
    const blockScrollInput = (e) => e.preventDefault();

    document.addEventListener('visibilitychange', onVisibility);
    window.addEventListener('blur', onBlur);
    window.addEventListener('keydown', onKeyDown, true);
    for (const type of SCROLL_INPUT_EVENTS) window.addEventListener(type, blockScrollInput, { capture: true, passive: false });

    const saved = saveState(el);
    const hidden = new Map();
    try {
      const { frames } = await runCapture(el, hidden, signal);
      ui.toast(`Captured ${frames} frame${frames === 1 ? '' : 's'}. The preview opened in a new tab.`, { timeout: 5000 });
    } catch (err) {
      const reason = err instanceof CaptureAbort ? err.message : `failed: ${err?.message || err}`;
      console.warn('[ScreenCapture] capture stopped:', err);
      ui.toast(`Capture stopped: ${reason}`, { timeout: 5000 });
    } finally {
      document.removeEventListener('visibilitychange', onVisibility);
      window.removeEventListener('blur', onBlur);
      window.removeEventListener('keydown', onKeyDown, true);
      for (const type of SCROLL_INPUT_EVENTS) window.removeEventListener(type, blockScrollInput, { capture: true });
      restoreHidden(hidden);
      restoreState(saved);
      ui.setVisible(true);
      busy = false;
    }
  }

  async function runCapture(el, hidden, signal) {
    const dpr = window.devicePixelRatio || 1;
    const check = () => {
      signal.throwIfAborted();
      if (!el.isConnected) throw new CaptureAbort('the element was removed from the page.');
    };

    for (const [prop, value] of Object.entries(CAPTURE_STYLE_OVERRIDES)) {
      el.style.setProperty(prop, value, 'important');
    }

    // Bring the whole container on screen if part of it is cut off by the viewport.
    let region = visibleRegion(el);
    if (!region || region.width < el.clientWidth || region.height < el.clientHeight) {
      el.scrollIntoView({ block: 'nearest', inline: 'nearest', behavior: 'instant' });
      region = visibleRegion(el);
    }
    if (!region) throw new CaptureAbort('the element is not visible in the viewport.');
    const outWidth = Math.round(region.width * dpr);

    await send({ type: 'sc:begin', width: outWidth, dpr });
    try {
      scrollElementTo(el, 0);
      let scrollTop = el.scrollTop;
      let base = null;       // content y of the first captured row
      let coveredTo = null;  // content y up to which rows are already captured
      let outHeight = 0;     // stitched height in device px
      let frame = 0;

      while (true) {
        const maxScroll = el.scrollHeight - el.clientHeight;
        const step = region.height;
        const total = frame + 1 + Math.ceil(Math.max(0, maxScroll - scrollTop) / step);
        ui.toast(`Capturing ${frame + 1}/${total}… (Esc to cancel)`);

        await settle(signal);
        check();

        region = visibleRegion(el);
        if (!region) throw new CaptureAbort('the element scrolled out of view.');
        const contentTop = scrollTop + region.offsetY;
        const contentBottom = contentTop + region.height;
        if (base === null) base = coveredTo = contentTop;

        const newStart = Math.max(coveredTo, contentTop);
        const destY = Math.round((newStart - base) * dpr);
        const destEnd = Math.round((contentBottom - base) * dpr);
        if (destEnd > destY) {
          hideStickyDescendants(el, hidden); // re-scanned each frame: virtualized lists add nodes as we go
          ui.setVisible(false);
          await raceAbort(waitForPaint(), signal);
          check();
          await raceAbort(send({
            type: 'sc:captureFrame',
            src: {
              x: Math.round(region.x * dpr),
              y: Math.round((region.y + (newStart - contentTop)) * dpr),
              width: Math.min(outWidth, Math.round(region.width * dpr)),
              height: destEnd - destY,
            },
            destY,
          }), signal);
          ui.setVisible(true);
          frame++;
          outHeight = destEnd;
        }
        coveredTo = Math.max(coveredTo, contentBottom);

        const latestMax = el.scrollHeight - el.clientHeight;
        if (scrollTop >= latestMax - 0.5 || frame >= MAX_FRAMES) break;
        const prev = scrollTop;
        scrollElementTo(el, Math.min(scrollTop + region.height, latestMax));
        scrollTop = el.scrollTop;
        if (scrollTop <= prev + 0.5) break; // the container refused to scroll further
      }

      check();
      ui.toast(`Stitching ${frame} frame${frame === 1 ? '' : 's'}…`);
      await send({ type: 'sc:finish', height: outHeight });
      return { frames: frame };
    } catch (err) {
      chrome.runtime.sendMessage({ type: 'sc:abort' }).catch(() => {});
      throw err;
    }
  }

  // The part of the element's client box (padding box, excluding borders and
  // scrollbars) that is inside the viewport, in CSS px. offsetY is how far the
  // visible top is below the client box top.
  //
  // Ancestors that clip overflow are intersected too: in app-style layouts the
  // container is often a few px taller than the panel around it, and treating
  // those hidden px as captured would drop that strip of content at every seam.
  function visibleRegion(el) {
    const rect = el.getBoundingClientRect();
    const left = rect.left + el.clientLeft;
    const top = rect.top + el.clientTop;
    const docEl = document.documentElement;
    // clientWidth/Height of <html> exclude the page's own scrollbars.
    const viewportW = Math.min(window.innerWidth, docEl.clientWidth || window.innerWidth);
    const viewportH = Math.min(window.innerHeight, docEl.clientHeight || window.innerHeight);
    let x0 = Math.max(left, 0);
    let y0 = Math.max(top, 0);
    let x1 = Math.min(left + el.clientWidth, viewportW);
    let y1 = Math.min(top + el.clientHeight, viewportH);

    for (let node = el; ;) {
      if (getComputedStyle(node).position === 'fixed') break; // fixed boxes escape ancestor clipping
      node = parentOf(node);
      // <body>/<html> overflow applies to the viewport, which is already handled.
      if (!node || node === document.body || node === docEl) break;
      const style = getComputedStyle(node);
      if (style.display === 'inline' || style.display === 'contents') continue;
      const clipsX = style.overflowX !== 'visible';
      const clipsY = style.overflowY !== 'visible';
      if (!clipsX && !clipsY) continue;
      const r = node.getBoundingClientRect();
      const nodeLeft = r.left + node.clientLeft;
      const nodeTop = r.top + node.clientTop;
      if (clipsX) {
        x0 = Math.max(x0, nodeLeft);
        x1 = Math.min(x1, nodeLeft + node.clientWidth);
      }
      if (clipsY) {
        y0 = Math.max(y0, nodeTop);
        y1 = Math.min(y1, nodeTop + node.clientHeight);
      }
    }

    if (x1 - x0 < 1 || y1 - y0 < 1) return null;
    return { x: x0, y: y0, width: x1 - x0, height: y1 - y0, offsetY: y0 - top };
  }

  function scrollElementTo(el, top) {
    el.scrollTo({ top, behavior: 'instant' });
  }

  // Saves everything a capture changes: the container's overridden inline styles
  // and the scroll position of the container and every ancestor (scrollIntoView
  // can move those).
  function saveState(el) {
    const styles = Object.keys(CAPTURE_STYLE_OVERRIDES).map((prop) => [
      prop, el.style.getPropertyValue(prop), el.style.getPropertyPriority(prop),
    ]);
    const scrolls = [];
    for (let node = el; node; node = parentOf(node)) scrolls.push([node, node.scrollTop, node.scrollLeft]);
    return { el, styles, scrolls };
  }

  function restoreState({ el, styles, scrolls }) {
    // Scroll first, while scroll-behavior is still forced to auto.
    for (const [node, top, left] of scrolls) {
      if (node.isConnected) node.scrollTo({ top, left, behavior: 'instant' });
    }
    for (const [prop, value, priority] of styles) {
      if (value) el.style.setProperty(prop, value, priority);
      else el.style.removeProperty(prop);
    }
  }

  // Sticky/fixed descendants would otherwise repeat in every frame.
  function hideStickyDescendants(el, hidden) {
    for (const node of el.querySelectorAll('*')) {
      if (hidden.has(node)) continue;
      const { position } = getComputedStyle(node);
      if (position !== 'sticky' && position !== 'fixed') continue;
      hidden.set(node, [node.style.getPropertyValue('visibility'), node.style.getPropertyPriority('visibility')]);
      node.style.setProperty('visibility', 'hidden', 'important');
    }
  }

  function restoreHidden(hidden) {
    for (const [node, [value, priority]] of hidden) {
      if (value) node.style.setProperty('visibility', value, priority);
      else node.style.removeProperty('visibility');
    }
    hidden.clear();
  }

  // --- timing helpers ---------------------------------------------------------

  const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

  // rAF never fires in a hidden tab; the timeout keeps us from hanging there
  // (the visibility listener aborts the capture in that case anyway).
  const nextFrame = () => new Promise((resolve) => {
    const timer = setTimeout(resolve, 100);
    requestAnimationFrame(() => { clearTimeout(timer); resolve(); });
  });

  async function waitForPaint() {
    await nextFrame();
    await nextFrame();
  }

  async function settle(signal) {
    await raceAbort(nextFrame(), signal);
    await raceAbort(sleep(settings.settleDelay), signal);
  }

  function raceAbort(promise, signal) {
    return new Promise((resolve, reject) => {
      if (signal.aborted) return reject(signal.reason);
      const onAbort = () => reject(signal.reason);
      signal.addEventListener('abort', onAbort, { once: true });
      promise.then(resolve, reject).finally(() => signal.removeEventListener('abort', onAbort));
    });
  }

  async function send(msg) {
    const res = await chrome.runtime.sendMessage(msg);
    if (!res?.ok) throw new Error(res?.error || 'No response from the extension background.');
    return res;
  }

  // ---------------------------------------------------------------------------
  // Messaging
  // ---------------------------------------------------------------------------

  chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
    if (msg?.type !== 'sc:startPicker') return;
    if (Number.isFinite(msg.settleDelay)) settings.settleDelay = msg.settleDelay;
    if (busy) {
      sendResponse({ ok: false, error: 'A capture is already running in this tab.' });
      return;
    }
    startPicker();
    sendResponse({ ok: true });
  });
})();
