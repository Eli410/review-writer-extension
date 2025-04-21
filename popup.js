document.addEventListener('DOMContentLoaded', async function() {
  const regenerateButton = document.getElementById('regenerateReview');
  const regeneratePersonaButton = document.getElementById('regeneratePersona');
  const regenerateAspectsButton = document.getElementById('regenerateAspects');
  const writeReviewButton = document.getElementById('writeReview');
  const statusDiv = document.getElementById('status');
  const productTitleDiv = document.getElementById('productTitle');
  const loadingDiv = document.getElementById('loading');
  const reviewOutputDiv = document.getElementById('reviewOutput');
  const copyButton = document.getElementById('copyReview');
  const extraDirectionsInput = document.getElementById('extraDirections');
  const aspectsContainer = document.getElementById('aspectsContainer');
  const reviewTitleDiv = document.getElementById('reviewTitle');
  const copyTitleButton = document.getElementById('copyTitle');
  
  // Persona input fields
  const personaAgeInput = document.getElementById('personaAge');
  const personaGenderInput = document.getElementById('personaGender');
  const personaOccupationInput = document.getElementById('personaOccupation');
  const personaDescriptionInput = document.getElementById('personaDescription');

  // Store the current tab ID
  let currentTabId = null;
  // Store the current aspects
  let currentAspects = [];
  // Flag to track if content script is available
  let contentScriptAvailable = false;
  // Flag to track if aspects and persona are loaded
  let aspectsLoaded = false;
  let personaLoaded = false;

  // Function to check if we're on an Amazon product page or review page
  async function checkAmazonPage() {
    try {
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
      currentTabId = tab.id; // Store the current tab ID
      
      if (!tab.url.includes('amazon.com')) {
        productTitleDiv.textContent = 'Please navigate to an Amazon product page';
        productTitleDiv.style.color = 'red';
        return false;
      }
      
      if (!tab.url.includes('/dp/') && !tab.url.includes('/review/review-your-purchases/')) {
        productTitleDiv.textContent = 'Please navigate to an Amazon product page or review page';
        productTitleDiv.style.color = 'red';
        return false;
      }
      
      return true;
    } catch (error) {
      console.error('Error checking Amazon page:', error);
      productTitleDiv.textContent = 'Error checking page: ' + error.message;
      productTitleDiv.style.color = 'red';
      return false;
    }
  }

  // Function to extract product ID from Amazon URL
  async function getProductId() {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    const url = tab.url;
    
    // Extract product ID from URL
    // Format: amazon.com/dp/B07QT8RTV2 or amazon.com/dp/B07QT8RTV2/
    const dpMatch = url.match(/\/dp\/([A-Z0-9]{10})/);
    if (dpMatch && dpMatch[1]) {
      return dpMatch[1];
    }
    
    // Format: amazon.com/review/review-your-purchases/?asin=B07QT8RTV2
    const asinMatch = url.match(/[?&]asin=([A-Z0-9]{10})/);
    if (asinMatch && asinMatch[1]) {
      return asinMatch[1];
    }
    
    return null;
  }

  // Function to get ASIN from content script
  async function getAsinFromContentScript() {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    
    // Make sure we're on an Amazon page
    if (!tab.url.includes('amazon.com')) {
      throw new Error('Please navigate to an Amazon product page');
    }
    
    try {
      // Try to inject the content script
      await ensureContentScriptInjected(tab.id);
      
      // Send message to content script to get ASIN
      const response = await chrome.tabs.sendMessage(tab.id, { action: 'getAsin' });
      
      if (response.error) {
        throw new Error(response.error);
      }
      
      return response.asin;
    } catch (error) {
      console.error('Error getting ASIN:', error);
      throw new Error(`Failed to get ASIN: ${error.message}`);
    }
  }

  // Function to open Amazon review page
  async function openAmazonReviewPage() {
    const productId = await getProductId();
    if (productId) {
      // Get the current review text and title from the textareas
      const reviewText = reviewOutputDiv.value;
      const reviewTitle = reviewTitleDiv.value;
      
      // Combine title and review text in the correct format
      const fullReviewText = `Title: ${reviewTitle}\n\nReview: ${reviewText}`;
      
      // Save the current review to storage
      await saveToStorage('review', fullReviewText);
      
      const reviewUrl = `https://www.amazon.com/review/review-your-purchases/?asin=${productId}`;
      
      // Open a new tab with the review URL
      const newTab = await chrome.tabs.create({ url: reviewUrl });
      
      // Wait for the tab to load and try multiple times if needed
      let attempts = 0;
      const maxAttempts = 3;
      
      const tryFillReview = async () => {
        try {
          // Inject the review-page.js script
          await chrome.scripting.executeScript({
            target: { tabId: newTab.id },
            files: ['review-page.js']
          });
          
          // Send a message to fill the textarea with the review text
          const response = await chrome.tabs.sendMessage(newTab.id, { 
            action: 'fillReviewTextarea',
            reviewText: fullReviewText
          });
          
          if (!response || !response.success) {
            throw new Error('Failed to fill review form');
          }
          
          console.log('Successfully filled review form');
        } catch (error) {
          console.error('Error filling review form:', error);
          attempts++;
          
          if (attempts < maxAttempts) {
            // Wait longer between each attempt
            setTimeout(tryFillReview, 1000 * attempts);
          } else {
            displayError('Failed to fill review form after multiple attempts');
          }
        }
      };
      
      // Start the first attempt after a short delay
      setTimeout(tryFillReview, 1000);
    } else {
      displayError('Could not extract product ID from URL');
    }
  }

  // Function to inject content script if needed
  async function ensureContentScriptInjected(tabId) {
    try {
      console.log('Checking if content script is already injected...');
      
      // First try to ping the content script
      try {
        const response = await chrome.tabs.sendMessage(tabId, { action: 'ping' });
        if (response && response.status === 'ok') {
          console.log('Content script already injected and responding');
          return true;
        }
      } catch (error) {
        console.log('Content script not loaded or not responding, will inject it...', error);
      }
      
      // If ping fails, inject the content script
      console.log('Injecting content script...');
      await chrome.scripting.executeScript({
        target: { tabId: tabId },
        files: ['content.js']
      });
      
      // Wait a moment for the script to initialize
      console.log('Waiting for script to initialize...');
      await new Promise(resolve => setTimeout(resolve, 1000));
      
      // Try to ping again to confirm it's working
      let retryCount = 0;
      const maxRetries = 3;
      
      while (retryCount < maxRetries) {
        try {
          const response = await chrome.tabs.sendMessage(tabId, { action: 'ping' });
          if (response && response.status === 'ok') {
            console.log('Content script successfully injected and responding');
            return true;
          }
        } catch (error) {
          console.log(`Ping attempt ${retryCount + 1} failed:`, error);
          retryCount++;
          
          if (retryCount < maxRetries) {
            // Wait before retrying
            await new Promise(resolve => setTimeout(resolve, 500));
          }
        }
      }
      
      // If we get here, all retries failed
      console.error('Failed to inject content script after multiple attempts');
      throw new Error('Failed to inject content script. Please refresh the page and try again.');
    } catch (error) {
      console.error('Error in ensureContentScriptInjected:', error);
      throw new Error(`Failed to inject content script: ${error.message}`);
    }
  }

  // Function to get product title
  async function getProductTitle() {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    
    // Make sure we're on an Amazon page
    if (!tab.url.includes('amazon.com')) {
      throw new Error('Please navigate to an Amazon product page');
    }
    
    try {
      // Try to inject the content script
      await ensureContentScriptInjected(tab.id);
      
      // Send message to content script to get product title
      const response = await chrome.tabs.sendMessage(tab.id, { action: 'getProductTitle' });
      
      if (response.error) {
        throw new Error(response.error);
      }
      
      return response.title;
    } catch (error) {
      console.error('Error getting product title:', error);
      throw new Error(`Failed to get product title: ${error.message}`);
    }
  }

  // Function to get product info
  async function getProductInfo() {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    
    // Make sure we're on an Amazon page
    if (!tab.url.includes('amazon.com')) {
      throw new Error('Please navigate to an Amazon product page');
    }
    
    try {
      // Try to inject the content script
      await ensureContentScriptInjected(tab.id);
      
      // Send message to content script to get product info
      const response = await chrome.tabs.sendMessage(tab.id, { action: 'getProductInfo' });
      
      if (response.error) {
        throw new Error(response.error);
      }
      
      return response.productInfo;
    } catch (error) {
      console.error('Error getting product info:', error);
      throw new Error(`Failed to get product info: ${error.message}`);
    }
  }

  // Function to show loading state
  function showLoading() {
    loadingDiv.style.display = 'block';
    regenerateButton.disabled = true;
    regeneratePersonaButton.disabled = true;
    regenerateAspectsButton.disabled = true;
    reviewOutputDiv.value = '';
    copyButton.style.display = 'none';
    copyTitleButton.style.display = 'none';
    writeReviewButton.style.display = 'none';
  }

  // Function to hide loading state
  function hideLoading() {
    loadingDiv.style.display = 'none';
    regenerateButton.disabled = false;
    regeneratePersonaButton.disabled = false;
    regenerateAspectsButton.disabled = false;
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
      // Get the ASIN from the URL
      const asin = await getAsinFromContentScript();
      
      // Use ASIN in the storage key if available
      const storageKey = asin ? `${key}_${asin}` : `${key}_${currentTabId}`;
      await chrome.storage.local.set({ [storageKey]: data });
      console.log(`Saved ${key} to storage with key: ${storageKey}`);
    } catch (error) {
      console.error(`Error saving ${key} to storage:`, error);
    }
  }

  // Function to get data from storage
  async function getFromStorage(key) {
    try {
      // Get the ASIN from the URL
      const asin = await getAsinFromContentScript();
      
      // Use ASIN in the storage key if available
      const storageKey = asin ? `${key}_${asin}` : `${key}_${currentTabId}`;
      const result = await chrome.storage.local.get(storageKey);
      console.log(`Retrieved ${key} from storage with key: ${storageKey}`, result[storageKey]);
      return result[storageKey];
    } catch (error) {
      console.error(`Error getting ${key} from storage:`, error);
      return null;
    }
  }

  // Function to clear storage for a tab
  async function clearStorageForTab(tabId) {
    try {
      const keys = await chrome.storage.local.get(null);
      const keysToRemove = Object.keys(keys).filter(key => key.endsWith(`_${tabId}`));
      if (keysToRemove.length > 0) {
        await chrome.storage.local.remove(keysToRemove);
      }
    } catch (error) {
      console.error('Error clearing storage:', error);
    }
  }

  // Function to update persona fields
  function updatePersonaFields(persona) {
    console.log('Updating persona fields with:', persona);
    
    if (!persona) {
      console.error('Cannot update persona fields: persona is null or undefined');
      return;
    }
    
    // Set default values if properties are missing
    personaAgeInput.value = persona.age || '';
    personaGenderInput.value = persona.gender || '';
    personaOccupationInput.value = persona.occupation || '';
    personaDescriptionInput.value = persona.description || '';
  }

  // Function to get current persona values
  function getCurrentPersona() {
    try {
      const age = parseInt(personaAgeInput.value) || 0;
      const gender = personaGenderInput.value || '';
      const occupation = personaOccupationInput.value || '';
      const description = personaDescriptionInput.value || '';
      
      const persona = {
        age: age,
        gender: gender,
        occupation: occupation,
        description: description
      };
      
      console.log('Current persona values:', persona);
      return persona;
    } catch (error) {
      console.error('Error getting current persona:', error);
      // Return a default persona if there's an error
      return {
        age: 0,
        gender: '',
        occupation: '',
        description: ''
      };
    }
  }

  // Function to update aspects display
  function updateAspectsDisplay(aspects) {
    console.log('Updating aspects display with:', aspects);
    
    if (!aspects || !Array.isArray(aspects) || aspects.length === 0) {
      console.error('Cannot update aspects display: aspects is invalid');
      aspectsContainer.innerHTML = '<div class="aspect-tag">No aspects available</div>';
      return;
    }
    
    // Clear the container
    aspectsContainer.innerHTML = '';
    
    // Add each aspect as a tag
    aspects.forEach(aspect => {
      const aspectTag = document.createElement('div');
      aspectTag.className = 'aspect-tag';
      aspectTag.textContent = aspect;
      aspectsContainer.appendChild(aspectTag);
    });
    
    // Store the current aspects
    currentAspects = aspects;
  }

  // Function to generate aspects
  async function generateAspects() {
    try {
      showLoading();
      statusDiv.textContent = 'Generating key aspects...';
      statusDiv.className = '';

      // Get product info from storage or fetch it
      let productInfo = await getFromStorage('productInfo');
      
      if (!productInfo) {
        productInfo = await getProductInfo();
        if (!productInfo) {
          throw new Error('Could not fetch product information');
        }
        // Save product info to storage
        await saveToStorage('productInfo', productInfo);
      }

      // Send message to content script to generate aspects
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
      
      // Make sure we're on an Amazon page
      if (!tab.url.includes('amazon.com')) {
        throw new Error('Please navigate to an Amazon product page');
      }
      
      try {
        // Try to inject the content script
        await ensureContentScriptInjected(tab.id);
        
        // Send the message to generate aspects
        const response = await chrome.tabs.sendMessage(tab.id, { 
          action: 'generateAspects',
          productInfo: productInfo
        });
        
        if (response.error) {
          throw new Error(response.error);
        }

        const aspects = response.aspects;
        // Save aspects to storage
        await saveToStorage('aspects', aspects);
        
        // Update the aspects display
        updateAspectsDisplay(aspects);
        
        statusDiv.textContent = 'Key aspects generated successfully!';
        statusDiv.className = 'success';
      } catch (error) {
        console.error('Error communicating with content script:', error);
        throw new Error(`Failed to generate aspects: ${error.message}`);
      }
    } catch (error) {
      displayError(error.message);
    } finally {
      hideLoading();
    }
  }

  // Function to check if we have a valid persona
  async function checkAndLoadPersona() {
    try {
      // Check if we have a stored persona
      const storedPersona = await getFromStorage('persona');
      console.log('Checking stored persona:', storedPersona);
      
      if (storedPersona && storedPersona.age && storedPersona.gender && 
          storedPersona.occupation && storedPersona.description) {
        // We have a valid persona, update the fields
        updatePersonaFields(storedPersona);
        statusDiv.textContent = 'Persona loaded from storage';
        statusDiv.className = 'success';
        personaLoaded = true;
        return true;
      } else {
        // No valid persona found, generate a new one
        console.log('No valid persona found, generating a new one');
        await generatePersona();
        personaLoaded = true;
        return false;
      }
    } catch (error) {
      console.error('Error checking persona:', error);
      // Generate a new persona if there's an error
      await generatePersona();
      personaLoaded = true;
      return false;
    }
  }

  // Function to check if we have valid aspects
  async function checkAndLoadAspects() {
    try {
      // Check if we have stored aspects
      const storedAspects = await getFromStorage('aspects');
      console.log('Checking stored aspects:', storedAspects);
      
      if (storedAspects && Array.isArray(storedAspects) && storedAspects.length > 0) {
        // We have valid aspects, update the display
        updateAspectsDisplay(storedAspects);
        aspectsLoaded = true;
        return true;
      } else {
        // No valid aspects found, generate new ones
        console.log('No valid aspects found, generating new ones');
        await generateAspects();
        aspectsLoaded = true;
        return false;
      }
    } catch (error) {
      console.error('Error checking aspects:', error);
      // Generate new aspects if there's an error
      await generateAspects();
      aspectsLoaded = true;
      return false;
    }
  }

  // Function to generate persona
  async function generatePersona() {
    try {
      showLoading();
      statusDiv.textContent = 'Generating persona...';
      statusDiv.className = '';

      // Get product info from storage or fetch it
      let productInfo = await getFromStorage('productInfo');
      
      if (!productInfo) {
        productInfo = await getProductInfo();
        if (!productInfo) {
          throw new Error('Could not fetch product information');
        }
        // Save product info to storage
        await saveToStorage('productInfo', productInfo);
      }

      // Send message to content script to generate persona
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
      
      // Make sure we're on an Amazon page
      if (!tab.url.includes('amazon.com')) {
        throw new Error('Please navigate to an Amazon product page');
      }
      
      try {
        // Try to inject the content script
        await ensureContentScriptInjected(tab.id);
        
        // Send the message to generate persona
        const response = await chrome.tabs.sendMessage(tab.id, { 
          action: 'generatePersona',
          productInfo: productInfo
        });
        
        if (response.error) {
          throw new Error(response.error);
        }

        const persona = response.persona;
        // Save persona to storage
        await saveToStorage('persona', persona);
        
        // Update the persona fields
        updatePersonaFields(persona);
        
        statusDiv.textContent = 'Persona generated successfully!';
        statusDiv.className = 'success';
      } catch (error) {
        console.error('Error communicating with content script:', error);
        throw new Error(`Failed to generate persona: ${error.message}`);
      }
    } catch (error) {
      displayError(error.message);
    } finally {
      hideLoading();
    }
  }

  // Function to generate review
  async function generateReview(extraDirections = '') {
    try {
      showLoading();
      statusDiv.textContent = 'Generating review...';
      statusDiv.className = '';

      // Get product info from storage or fetch it
      let productInfo = await getFromStorage('productInfo');
      
      if (!productInfo) {
        productInfo = await getProductInfo();
        if (!productInfo) {
          throw new Error('Could not fetch product information');
        }
        // Save product info to storage
        await saveToStorage('productInfo', productInfo);
      }

      // Get current persona
      const persona = getCurrentPersona();
      
      // Get current aspects
      const aspects = currentAspects;
      
      // Create extra directions with aspects if available
      let finalExtraDirections = extraDirections;
      if (aspects && aspects.length > 0) {
        const aspectsText = `Please focus on these key aspects in your review: ${aspects.join(', ')}.`;
        finalExtraDirections = aspectsText + (extraDirections ? '\n\n' + extraDirections : '');
      }

      // Send message to content script to generate review
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
      
      // Make sure we're on an Amazon page
      if (!tab.url.includes('amazon.com')) {
        throw new Error('Please navigate to an Amazon product page');
      }
      
      try {
        // Try to inject the content script
        await ensureContentScriptInjected(tab.id);
        
        // Send the message to generate review
        const response = await chrome.tabs.sendMessage(tab.id, { 
          action: 'generateReview',
          productInfo: productInfo,
          persona: persona,
          extraDirections: finalExtraDirections
        });
        
        if (response.error) {
          throw new Error(response.error);
        }

        const reviewText = response.review;
        
        // Parse the review text to separate title and review
        const { title, review } = parseReviewText(reviewText);
        
        // Save review to storage
        await saveToStorage('review', reviewText);
        
        // Set the review text in the textarea
        reviewOutputDiv.value = review;
        reviewTitleDiv.value = title;
        
        // Show the copy buttons
        copyButton.style.display = 'block';
        copyTitleButton.style.display = 'block';
        regenerateButton.style.display = 'block';
        writeReviewButton.style.display = 'block';
        
        statusDiv.textContent = 'Review generated successfully!';
        statusDiv.className = 'success';
      } catch (error) {
        console.error('Error communicating with content script:', error);
        throw new Error(`Failed to generate review: ${error.message}`);
      }
    } catch (error) {
      displayError(error.message);
    } finally {
      hideLoading();
    }
  }

  // Function to parse review text to separate title and review
  function parseReviewText(text) {
    console.log('Parsing review text:', text);
    
    // Default values
    let title = 'Product Review';
    let review = text;
    
    try {
      // Try to extract title and review using the new format
      const titleMatch = text.match(/Title:\s*([^\n]+)/i);
      const reviewMatch = text.match(/Review:\s*([\s\S]+?)(?=\n\nTitle:|$)/i);
      
      if (titleMatch && reviewMatch) {
        title = titleMatch[1].trim();
        review = reviewMatch[1].trim();
      } else {
        // If the format is not found, try to split by paragraphs
        const paragraphs = text.split('\n\n').filter(p => p.trim());
        
        if (paragraphs.length >= 2) {
          // Assume first paragraph is review, second is title
          review = paragraphs[0].trim();
          title = paragraphs[1].trim();
        } else if (paragraphs.length === 1) {
          // If only one paragraph, use it as the review
          review = paragraphs[0].trim();
        }
      }
      
      console.log('Parsed title:', title);
      console.log('Parsed review:', review);
      
      return { title, review };
    } catch (error) {
      console.error('Error parsing review text:', error);
      // Return the original text as review if parsing fails
      return { title: 'Product Review', review: text };
    }
  }

  // Function to copy review to clipboard
  copyButton.addEventListener('click', () => {
    const reviewText = reviewOutputDiv.value;
    navigator.clipboard.writeText(reviewText).then(() => {
      const originalText = copyButton.textContent;
      copyButton.textContent = 'Copied!';
      setTimeout(() => {
        copyButton.textContent = originalText;
      }, 2000);
    });
  });

  // Function to copy title to clipboard
  copyTitleButton.addEventListener('click', () => {
    const titleText = reviewTitleDiv.value;
    navigator.clipboard.writeText(titleText).then(() => {
      const originalText = copyTitleButton.textContent;
      copyTitleButton.textContent = 'Copied!';
      setTimeout(() => {
        copyTitleButton.textContent = originalText;
      }, 2000);
    });
  });

  // Regenerate persona button click handler
  regeneratePersonaButton.addEventListener('click', () => {
    generatePersona();
  });

  // Regenerate aspects button click handler
  regenerateAspectsButton.addEventListener('click', () => {
    generateAspects();
  });

  // Write Review button click handler
  writeReviewButton.addEventListener('click', () => {
    openAmazonReviewPage();
  });

  // Function to check if we should auto-generate a review
  async function checkAndAutoGenerateReview() {
    // Only auto-generate if both aspects and persona are loaded
    if (aspectsLoaded && personaLoaded) {
      // Check if we already have a review
      const storedReview = await getFromStorage('review');
      
      if (!storedReview) {
        // Auto-generate the review
        await generateReview(extraDirectionsInput.value);
      }
    }
  }

  // Check if we're on an Amazon product page or review page and get the title
  try {
    const isAmazonPage = await checkAmazonPage();
    if (isAmazonPage) {
      try {
        // Try to inject the content script
        const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
        await ensureContentScriptInjected(tab.id);
        contentScriptAvailable = true;
        
        // Get the ASIN from the URL
        const asin = await getAsinFromContentScript();
        
        if (asin) {
          // Check if we have a stored review for this ASIN
          const storedReview = await getFromStorage('review');
          
          if (storedReview) {
            // Parse the stored review to get title and review
            const { title, review } = parseReviewText(storedReview);
            
            // Set the review text and title in the textareas
            reviewOutputDiv.value = review;
            reviewTitleDiv.value = title;
            
            copyButton.style.display = 'block';
            copyTitleButton.style.display = 'block';
            regenerateButton.style.display = 'block';
            writeReviewButton.style.display = 'block';
            statusDiv.textContent = 'Review loaded from storage';
            statusDiv.className = 'success';
            
            // Make sure we have a valid persona
            await checkAndLoadPersona();
            
            // Make sure we have valid aspects
            await checkAndLoadAspects();
          } else {
            // Try to get the product title
            const title = await getProductTitle();
            if (title) {
              productTitleDiv.textContent = title;
              productTitleDiv.style.display = 'block';
              
              // Show the write review button
              writeReviewButton.style.display = 'block';
              
              // Check if we have valid aspects
              await checkAndLoadAspects();
              
              // Check if we have a valid persona
              await checkAndLoadPersona();
              
              // Auto-generate the review if both aspects and persona are loaded
              await checkAndAutoGenerateReview();
            } else {
              productTitleDiv.textContent = 'Could not fetch product title';
              productTitleDiv.style.color = 'red';
            }
          }
        } else {
          productTitleDiv.textContent = 'Could not extract product ID from URL';
          productTitleDiv.style.color = 'red';
        }
      } catch (error) {
        console.error('Error initializing extension:', error);
        productTitleDiv.textContent = 'Error initializing extension: ' + error.message;
        productTitleDiv.style.color = 'red';
      }
    }
  } catch (error) {
    console.error('Error checking Amazon page:', error);
    productTitleDiv.textContent = 'Error checking page: ' + error.message;
    productTitleDiv.style.color = 'red';
  }

  // Listen for tab updates to clear stored data when tab is closed
  chrome.tabs.onRemoved.addListener(async (tabId) => {
    if (tabId === currentTabId) {
      // Clear stored data when the tab is closed
      await clearStorageForTab(tabId);
      currentTabId = null;
    }
  });
}); 