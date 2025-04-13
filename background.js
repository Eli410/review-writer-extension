// Listen for tab removal events
chrome.tabs.onRemoved.addListener(async (tabId) => {
  // This event is triggered when a tab is closed
  console.log(`Tab ${tabId} was closed`);
  
  // Clean up stored data for this tab
  try {
    await chrome.storage.local.remove([`productInfo_${tabId}`, `review_${tabId}`]);
    console.log(`Cleared storage for tab ${tabId}`);
  } catch (error) {
    console.error(`Error clearing storage for tab ${tabId}:`, error);
  }
}); 