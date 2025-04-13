document.addEventListener('DOMContentLoaded', async function() {
  const generateButton = document.getElementById('generateReview');
  const regenerateButton = document.getElementById('regenerateReview');
  const statusDiv = document.getElementById('status');
  const productTitleDiv = document.getElementById('productTitle');
  const loadingDiv = document.getElementById('loading');
  const reviewOutputDiv = document.getElementById('reviewOutput');
  const copyButton = document.getElementById('copyReview');
  const extraDirectionsInput = document.getElementById('extraDirections');

  // Store the current tab ID
  let currentTabId = null;

  // Function to check if we're on an Amazon product page
  async function checkAmazonProductPage() {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    currentTabId = tab.id; // Store the current tab ID
    return tab.url.includes('amazon.com') && tab.url.includes('/dp/');
  }

  // Function to inject content script if needed
  async function ensureContentScriptInjected(tabId) {
    try {
      await chrome.tabs.sendMessage(tabId, { action: 'ping' });
    } catch (error) {
      // Content script not loaded, inject it
      await chrome.scripting.executeScript({
        target: { tabId: tabId },
        files: ['content.js']
      });
    }
  }

  // Function to get product title
  async function getProductTitle() {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    try {
      await ensureContentScriptInjected(tab.id);
      const response = await chrome.tabs.sendMessage(tab.id, { action: 'getProductTitle' });
      return response.title;
    } catch (error) {
      console.error('Error getting product title:', error);
      return null;
    }
  }

  // Function to get product info
  async function getProductInfo() {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    try {
      await ensureContentScriptInjected(tab.id);
      const response = await chrome.tabs.sendMessage(tab.id, { action: 'getProductInfo' });
      return response.productInfo;
    } catch (error) {
      console.error('Error getting product info:', error);
      return null;
    }
  }

  // Function to show loading state
  function showLoading() {
    loadingDiv.style.display = 'block';
    generateButton.disabled = true;
    regenerateButton.disabled = true;
    reviewOutputDiv.textContent = '';
    copyButton.style.display = 'none';
    regenerateButton.style.display = 'none';
  }

  // Function to hide loading state
  function hideLoading() {
    loadingDiv.style.display = 'none';
    generateButton.disabled = false;
    regenerateButton.disabled = false;
  }

  // Function to display error message
  function displayError(message) {
    statusDiv.textContent = message;
    statusDiv.className = 'error';
    console.error(message);
  }

  // Function to save data to storage
  async function saveToStorage(key, data) {
    try {
      await chrome.storage.local.set({ [key]: data });
    } catch (error) {
      console.error(`Error saving ${key} to storage:`, error);
    }
  }

  // Function to get data from storage
  async function getFromStorage(key) {
    try {
      const result = await chrome.storage.local.get(key);
      return result[key];
    } catch (error) {
      console.error(`Error getting ${key} from storage:`, error);
      return null;
    }
  }

  // Function to generate review
  async function generateReview(extraDirections = '') {
    try {
      showLoading();

      // Get product info from storage or fetch it
      let productInfo = await getFromStorage(`productInfo_${currentTabId}`);
      
      if (!productInfo) {
        productInfo = await getProductInfo();
        if (!productInfo) {
          throw new Error('Could not fetch product information');
        }
        // Save product info to storage
        await saveToStorage(`productInfo_${currentTabId}`, productInfo);
      }

      // Send message to content script to generate review
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
      await ensureContentScriptInjected(tab.id);
      const response = await chrome.tabs.sendMessage(tab.id, { 
        action: 'generateReview',
        productInfo: productInfo,
        extraDirections: extraDirections
      });
      
      if (response.error) {
        throw new Error(response.error);
      }

      const review = response.review;
      // Save review to storage
      await saveToStorage(`review_${currentTabId}`, review);
      
      reviewOutputDiv.textContent = review;
      copyButton.style.display = 'block';
      regenerateButton.style.display = 'block';
      statusDiv.textContent = 'Review generated successfully!';
      statusDiv.className = 'success';
    } catch (error) {
      displayError(error.message);
    } finally {
      hideLoading();
    }
  }

  // Function to copy review to clipboard
  copyButton.addEventListener('click', () => {
    const reviewText = reviewOutputDiv.textContent;
    navigator.clipboard.writeText(reviewText).then(() => {
      const originalText = copyButton.textContent;
      copyButton.textContent = 'Copied!';
      setTimeout(() => {
        copyButton.textContent = originalText;
      }, 2000);
    });
  });

  // Regenerate button click handler
  regenerateButton.addEventListener('click', () => {
    generateReview(extraDirectionsInput.value);
  });

  // Check if we're on an Amazon product page and get the title
  const isProductPage = await checkAmazonProductPage();
  if (isProductPage) {
    const title = await getProductTitle();
    if (title) {
      productTitleDiv.textContent = title;
      productTitleDiv.style.display = 'block';
      
      // Check if we have a stored review for this tab
      const storedReview = await getFromStorage(`review_${currentTabId}`);
      if (storedReview) {
        reviewOutputDiv.textContent = storedReview;
        copyButton.style.display = 'block';
        regenerateButton.style.display = 'block';
        statusDiv.textContent = 'Review loaded from storage';
        statusDiv.className = 'success';
      }
    } else {
      productTitleDiv.textContent = 'Could not fetch product title';
      productTitleDiv.style.color = 'red';
    }
  } else {
    productTitleDiv.textContent = 'Please navigate to an Amazon product page';
    productTitleDiv.style.color = 'red';
  }

  // Generate button click handler
  generateButton.addEventListener('click', () => {
    generateReview(extraDirectionsInput.value);
  });

  // Listen for tab updates to clear stored data when tab is closed
  chrome.tabs.onRemoved.addListener(async (tabId) => {
    if (tabId === currentTabId) {
      // Clear stored data when the tab is closed
      await chrome.storage.local.remove([`productInfo_${tabId}`, `review_${tabId}`]);
      currentTabId = null;
    }
  });
}); 