const startBtn = document.getElementById('start');
const settingsBtn = document.getElementById('settings');
const statusEl = document.getElementById('status');

settingsBtn.addEventListener('click', () => {
  chrome.runtime.openOptionsPage();
  window.close();
});

startBtn.addEventListener('click', async () => {
  statusEl.textContent = '';
  startBtn.disabled = true;
  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!tab?.id) throw new Error('No active tab.');

    // Opening the popup grants activeTab for this tab, which covers both script
    // injection here and captureVisibleTab in the service worker later.
    await chrome.scripting.executeScript({ target: { tabId: tab.id }, files: ['content.js'] });

    const res = await chrome.tabs.sendMessage(tab.id, {
      type: 'sc:startPicker',
      settleDelay: Settings.getSettleDelay(),
    });
    if (!res?.ok) throw new Error(res?.error || 'Content script did not respond.');

    window.close();
  } catch (err) {
    statusEl.textContent = `Can't start on this page: ${err.message}`;
    startBtn.disabled = false;
  }
});
