// Preview page: shows a finished capture from IndexedDB and lets the user copy,
// download or discard it. Opened by background.js as preview.html?id=<capture id>.

const id = new URLSearchParams(location.search).get('id');

const els = {
  meta: document.getElementById('meta'),
  parts: document.getElementById('parts'),
  status: document.getElementById('status'),
  copy: document.getElementById('copy'),
  download: document.getElementById('download'),
  saveAs: document.getElementById('save-as'),
  zoom: document.getElementById('zoom'),
  discard: document.getElementById('discard'),
};

let capture = null;
let objectUrls = [];

init().catch((err) => showEmpty(`Couldn't load this capture: ${err.message}`));

async function init() {
  capture = id ? await CaptureDB.get(id) : null;
  if (!capture) {
    showEmpty('This capture is no longer available. Only the 5 most recent captures are kept.');
    return;
  }

  const { parts, width, height, dpr, pageTitle, pageUrl, stamp } = capture;
  document.title = `ScreenCapture ${stamp}`;
  objectUrls = parts.map((part) => URL.createObjectURL(part.blob));

  const sizeText = `${width} × ${height} px`;
  const partsText = parts.length > 1 ? ` · ${parts.length} parts` : '';
  els.meta.textContent = `${sizeText}${partsText} · `;
  if (pageUrl) {
    const link = document.createElement('a');
    link.href = pageUrl;
    link.target = '_blank';
    link.rel = 'noopener';
    link.textContent = pageTitle || pageUrl;
    els.meta.appendChild(link);
  } else {
    els.meta.append(pageTitle || 'Unknown page');
  }

  parts.forEach((part, i) => els.parts.appendChild(renderPart(part, i, dpr)));

  // The clipboard takes a single image, so with several parts copying is per part.
  const multi = parts.length > 1;
  els.copy.disabled = multi;
  els.copy.title = multi ? 'This capture was split into parts. Use the Copy button on each part.' : '';
  for (const button of [els.download, els.saveAs, els.zoom, els.discard]) button.disabled = false;
}

function renderPart(part, index, dpr) {
  const section = document.createElement('section');
  section.className = 'part';

  if (capture.parts.length > 1) {
    const bar = document.createElement('div');
    bar.className = 'part-bar';
    const label = document.createElement('span');
    label.textContent = `Part ${index + 1} of ${capture.parts.length} · ${part.width} × ${part.height} px`;
    const actions = document.createElement('div');
    actions.className = 'actions';
    actions.append(
      makeButton('Copy', () => copyPart(index)),
      makeButton('Download', () => downloadPart(index, false)),
    );
    bar.append(label, actions);
    section.appendChild(bar);
  }

  const frame = document.createElement('div');
  frame.className = 'frame';
  const img = document.createElement('img');
  img.src = objectUrls[index];
  img.alt = `Captured image${capture.parts.length > 1 ? `, part ${index + 1}` : ''}`;
  // Display at the size it had on the page: device px / devicePixelRatio at capture time.
  img.style.width = `${part.width / dpr}px`;
  img.addEventListener('click', toggleZoom);
  frame.appendChild(img);
  section.appendChild(frame);
  return section;
}

function makeButton(text, onClick) {
  const button = document.createElement('button');
  button.textContent = text;
  button.addEventListener('click', onClick);
  return button;
}

// --- actions -------------------------------------------------------------------

els.copy.addEventListener('click', () => copyPart(0));
els.download.addEventListener('click', () => downloadAll(false));
els.saveAs.addEventListener('click', () => downloadAll(true));
els.zoom.addEventListener('click', toggleZoom);
els.discard.addEventListener('click', discard);

async function copyPart(index) {
  try {
    await navigator.clipboard.write([new ClipboardItem({ 'image/png': capture.parts[index].blob })]);
    flash('Copied to clipboard');
  } catch (err) {
    flash(`Copy failed: ${err.message}`);
  }
}

async function downloadAll(saveAs) {
  for (let i = 0; i < capture.parts.length; i++) {
    if (!(await downloadPart(i, saveAs))) return;
  }
}

async function downloadPart(index, saveAs) {
  const count = capture.parts.length;
  const suffix = count > 1 ? `_part${index + 1}of${count}` : '';
  try {
    await chrome.downloads.download({
      url: objectUrls[index],
      filename: `screencapture_${capture.stamp}${suffix}.png`,
      conflictAction: 'uniquify',
      saveAs,
    });
    if (!saveAs) flash(count > 1 ? `Downloading part ${index + 1} of ${count}` : 'Downloading');
    return true;
  } catch (err) {
    // Cancelling the Save as dialog also rejects; don't treat that as an error.
    if (!/cancel/i.test(err.message)) flash(`Download failed: ${err.message}`);
    return false;
  }
}

function toggleZoom() {
  const fit = document.body.classList.toggle('fit');
  els.zoom.textContent = fit ? 'Actual size' : 'Fit to window';
}

async function discard() {
  await CaptureDB.delete(id);
  const tab = await chrome.tabs.getCurrent();
  if (tab?.id) chrome.tabs.remove(tab.id);
  else window.close();
}

// --- helpers -------------------------------------------------------------------

let flashTimer = 0;
function flash(text) {
  els.status.textContent = text;
  els.status.classList.add('show');
  clearTimeout(flashTimer);
  flashTimer = setTimeout(() => els.status.classList.remove('show'), 2000);
}

function showEmpty(text) {
  els.meta.textContent = '';
  const p = document.createElement('p');
  p.className = 'empty';
  p.textContent = text;
  els.parts.replaceChildren(p);
}

window.addEventListener('pagehide', () => objectUrls.forEach((url) => URL.revokeObjectURL(url)));
