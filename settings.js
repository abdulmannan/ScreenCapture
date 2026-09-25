// Settings shared by the popup and the options page. Both are extension pages on
// the same origin, so they share localStorage; this avoids the "storage" permission.

const Settings = (() => {
  const DEFAULT_SETTLE_DELAY = 350;
  const MAX_SETTLE_DELAY = 5000;
  const SETTLE_DELAY_KEY = 'sc.settleDelay';

  function clampDelay(n) {
    return Math.min(MAX_SETTLE_DELAY, Math.max(0, Math.round(n)));
  }

  return {
    DEFAULT_SETTLE_DELAY,
    MAX_SETTLE_DELAY,

    getSettleDelay() {
      const raw = localStorage.getItem(SETTLE_DELAY_KEY);
      const n = raw === null ? NaN : Number(raw);
      return Number.isFinite(n) ? clampDelay(n) : DEFAULT_SETTLE_DELAY;
    },

    // Returns the value actually stored (clamped, or the default for invalid input).
    setSettleDelay(value) {
      const n = Number(value);
      const delay = value !== '' && Number.isFinite(n) ? clampDelay(n) : DEFAULT_SETTLE_DELAY;
      localStorage.setItem(SETTLE_DELAY_KEY, String(delay));
      return delay;
    },
  };
})();
