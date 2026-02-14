/**
 * Single source of truth for storage key format.
 * Data keyed by ASIN persists across sessions; data keyed by tabId is cleared when the tab is closed.
 * @param {string} key - One of: 'review', 'aspects', 'persona', 'productInfo'
 * @param {string|number} asinOrTabId - ASIN (string) when available, otherwise tab ID (number)
 * @returns {string}
 */
function getStorageKey(key, asinOrTabId) {
  return `${key}_${asinOrTabId}`;
}
