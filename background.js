// Service worker for ScreenCapture.
//
// The content script drives the capture and sends, per tab:
//   sc:begin          { width, dpr }        start a session (width in device px)
//   sc:captureFrame   { src, destY }      screenshot the tab, keep the src crop, placed at destY
//   sc:finish         { height }            stitch the crops into PNG(s), store them, open the preview tab
//   sc:abort                                drop the session

importScripts('db.js');

// Finished captures are kept in IndexedDB so the preview tab can be reloaded;
// older ones are pruned when a new capture is stored.
const MAX_KEPT_CAPTURES = 5;

// Chrome allows about 2 captureVisibleTab calls per second per extension.
const MIN_CAPTURE_INTERVAL_MS = 600;
const MAX_QUOTA_RETRIES = 3;

// Chrome's canvas limits. Taller results are split into several PNGs.
const MAX_CANVAS_DIM = 32767;
const MAX_CANVAS_AREA = 268435456;

const sessions = new Map(); // tabId -> { width, dpr, crops: [{ bitmap, destY }] }
let captureQueue = Promise.resolve();
let lastCaptureAt = 0;

const handlers = {
  'sc:begin': begin,
  'sc:captureFrame': captureFrame,
  'sc:finish': finish,
  'sc:abort': (msg, tab) => discardSession(tab.id),
};

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  const handler = handlers[msg?.type];
  if (!handler) return;
  if (!sender.tab?.id) {
    sendResponse({ ok: false, error: 'Messages must come from a tab.' });
    return;
  }
  Promise.resolve()
    .then(() => handler(msg, sender.tab))
    .then(
      (result) => sendResponse({ ok: true, ...result }),
      (err) => sendResponse({ ok: false, error: err?.message || String(err) }),
    );
  return true; // respond asynchronously
});

chrome.tabs.onRemoved.addListener((tabId) => discardSession(tabId));

function begin(msg, tab) {
  if (!(msg.width > 0)) throw new Error('Invalid capture width.');
  discardSession(tab.id);
  sessions.set(tab.id, { width: msg.width, dpr: msg.dpr || 1, crops: [] });
}

function discardSession(tabId) {
  const session = sessions.get(tabId);
  if (!session) return;
  sessions.delete(tabId);
  for (const { bitmap } of session.crops) bitmap.close();
}

async function captureFrame(msg, tab) {
  const session = sessions.get(tab.id);
  if (!session) throw new Error('Capture session lost (the extension may have restarted). Please try again.');

  const dataUrl = await queueCapture(tab);
  const full = await createImageBitmap(await (await fetch(dataUrl)).blob());
  let crop;
  try {
    const { src } = msg;
    const sx = Math.min(Math.max(0, src.x), full.width - 1);
    const sy = Math.min(Math.max(0, src.y), full.height - 1);
    const sw = Math.min(src.width, full.width - sx);
    const sh = Math.min(src.height, full.height - sy);
    if (sw < 1 || sh < 1) throw new Error('Crop region is outside the captured image.');
    crop = await createImageBitmap(full, sx, sy, sw, sh);
  } finally {
    full.close();
  }

  // The session may have been aborted while we were waiting on the capture.
  if (sessions.get(tab.id) !== session) {
    crop.close();
    throw new Error('Capture session was cancelled.');
  }
  session.crops.push({ bitmap: crop, destY: msg.destY });
}

// Serializes captures across all tabs and spaces them out to respect the rate limit.
function queueCapture(tab) {
  const run = captureQueue.then(() => captureWithRetry(tab));
  captureQueue = run.catch(() => {});
  return run;
}

async function captureWithRetry(tab) {
  for (let attempt = 0; ; attempt++) {
    const wait = lastCaptureAt + MIN_CAPTURE_INTERVAL_MS - Date.now();
    if (wait > 0) await sleep(wait);
    await assertTabVisible(tab.id);
    lastCaptureAt = Date.now();
    try {
      return await chrome.tabs.captureVisibleTab(tab.windowId, { format: 'png' });
    } catch (err) {
      const quota = /MAX_CAPTURE_VISIBLE_TAB_CALLS_PER_SECOND/.test(err?.message);
      if (!quota || attempt >= MAX_QUOTA_RETRIES) throw err;
    }
  }
}

// captureVisibleTab grabs whatever tab is showing in the window, so make sure
// that is still ours before every frame.
async function assertTabVisible(tabId) {
  const tab = await chrome.tabs.get(tabId);
  if (!tab.active) throw new Error('The tab is no longer active.');
  const win = await chrome.windows.get(tab.windowId);
  if (win.state === 'minimized') throw new Error('The window was minimized.');
}

async function finish(msg, tab) {
  const session = sessions.get(tab.id);
  if (!session) throw new Error('Capture session lost (the extension may have restarted). Please try again.');
  sessions.delete(tab.id);

  try {
    const { width, crops } = session;
    const height = Math.round(msg.height);
    if (!crops.length || height < 1) throw new Error('Nothing was captured.');
    if (width > MAX_CANVAS_DIM) throw new Error('The element is too wide to stitch.');

    const partHeight = Math.min(MAX_CANVAS_DIM, Math.floor(MAX_CANVAS_AREA / width));
    const partCount = Math.ceil(height / partHeight);
    const parts = [];

    for (let p = 0; p < partCount; p++) {
      const top = p * partHeight;
      const h = Math.min(partHeight, height - top);
      const canvas = new OffscreenCanvas(width, h);
      const ctx = canvas.getContext('2d');
      for (const { bitmap, destY } of crops) {
        if (destY + bitmap.height <= top || destY >= top + h) continue;
        ctx.drawImage(bitmap, 0, destY - top);
      }
      parts.push({ blob: await canvas.convertToBlob({ type: 'image/png' }), width, height: h });
    }

    const id = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    await CaptureDB.put({
      id,
      stamp: timestamp(),
      dpr: session.dpr,
      width,
      height,
      pageTitle: tab.title || '',
      pageUrl: tab.url || '',
      parts,
    });
    await pruneOldCaptures();

    await chrome.tabs.create({
      url: chrome.runtime.getURL(`preview.html?id=${encodeURIComponent(id)}`),
      index: tab.index + 1,
      openerTabId: tab.id,
    });
    return { id, parts: partCount, width, height };
  } finally {
    for (const { bitmap } of session.crops) bitmap.close();
  }
}

// Keys start with Date.now(), so ascending key order is oldest first.
async function pruneOldCaptures() {
  const keys = await CaptureDB.keys();
  for (const key of keys.slice(0, -MAX_KEPT_CAPTURES)) await CaptureDB.delete(key);
}

function timestamp() {
  const d = new Date();
  const pad = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}_${pad(d.getHours())}-${pad(d.getMinutes())}-${pad(d.getSeconds())}`;
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
