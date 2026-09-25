const delayInput = document.getElementById('delay');
const resetBtn = document.getElementById('reset');
const savedEl = document.getElementById('saved');

delayInput.value = Settings.getSettleDelay();

delayInput.addEventListener('change', () => {
  delayInput.value = Settings.setSettleDelay(delayInput.value);
  showSaved();
});

resetBtn.addEventListener('click', () => {
  delayInput.value = Settings.setSettleDelay(Settings.DEFAULT_SETTLE_DELAY);
  showSaved();
});

let savedTimer = 0;
function showSaved() {
  savedEl.classList.add('show');
  clearTimeout(savedTimer);
  savedTimer = setTimeout(() => savedEl.classList.remove('show'), 1500);
}
