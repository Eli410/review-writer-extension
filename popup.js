document.addEventListener('DOMContentLoaded', async function () {
  const regenerateReviewButton = document.getElementById('regenerateReview');
  const regeneratePersonaButton = document.getElementById('regeneratePersona');
  const regenerateAspectsButton = document.getElementById('regenerateAspects');
  const writeReviewButton = document.getElementById('writeReview');
  const statusDiv = document.getElementById('status');
  const productTitleDiv = document.getElementById('productTitle');
  const reviewOutputDiv = document.getElementById('reviewOutput');
  const copyButton = document.getElementById('copyReview');
  const aspectsContainer = document.getElementById('aspectsContainer');
  const reviewTitleDiv = document.getElementById('reviewTitle');
  const copyTitleButton = document.getElementById('copyTitle');
  const personaAgeInput = document.getElementById('personaAge');
  const personaGenderInput = document.getElementById('personaGender');
  const personaOccupationInput = document.getElementById('personaOccupation');
  const personaDescriptionInput = document.getElementById('personaDescription');
  const tabMain = document.getElementById('tabMain');
  const tabSettings = document.getElementById('tabSettings');
  const panelMain = document.getElementById('panelMain');
  const panelSettings = document.getElementById('panelSettings');
  const settingsProvider = document.getElementById('settingsProvider');
  const settingsModel = document.getElementById('settingsModel');
  const settingsSave = document.getElementById('settingsSave');
  const settingsStatus = document.getElementById('settingsStatus');
  const currentModelLabel = document.getElementById('currentModelLabel');

  let currentTabId = null;
  let currentAspects = [];
  let aspectsLoaded = false;
  let personaLoaded = false;

  const MODEL_OPTIONS = {
    openrouter: [
      { id: 'anthropic/claude-haiku-4.5', label: 'Claude Haiku 4.5' },
      { id: 'google/gemini-3-flash-preview', label: 'Gemini 3 Flash (Preview)' },
      { id: 'openai/gpt-5-mini', label: 'GPT-5 Mini' },
      { id: 'moonshotai/kimi-k2.5', label: 'Kimi K2.5' },
    ],
  };

  async function getAsinOrTabId() {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    currentTabId = tab?.id ?? null;
    if (!tab?.url?.includes('amazon.com')) return { asinOrTabId: currentTabId, isTabFallback: true };
    try {
      await ensureContentScriptInjected(tab.id);
      const response = await chrome.tabs.sendMessage(tab.id, { action: 'getAsin' });
      if (response?.asin) return { asinOrTabId: response.asin, isTabFallback: false };
    } catch (_) {}
    return { asinOrTabId: currentTabId, isTabFallback: true };
  }

  async function checkAmazonPage() {
    try {
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
      currentTabId = tab?.id;
      if (!tab?.url?.includes('amazon.com')) {
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
      productTitleDiv.textContent = 'Error: ' + (error?.message || 'Unknown');
      productTitleDiv.style.color = 'red';
      return false;
    }
  }

  async function ensureContentScriptInjected(tabId) {
    try {
      try {
        const response = await chrome.tabs.sendMessage(tabId, { action: 'ping' });
        if (response?.status === 'ok') return true;
      } catch (_) {}
      await chrome.scripting.executeScript({ target: { tabId }, files: ['content.js'] });
      await new Promise((r) => setTimeout(r, 800));
      for (let i = 0; i < 3; i++) {
        try {
          const response = await chrome.tabs.sendMessage(tabId, { action: 'ping' });
          if (response?.status === 'ok') return true;
        } catch (_) {}
        await new Promise((r) => setTimeout(r, 400));
      }
      throw new Error('Content script not ready. Refresh the page and try again.');
    } catch (error) {
      throw new Error(error?.message || 'Failed to inject content script');
    }
  }

  async function getProductTitle() {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!tab?.url?.includes('amazon.com')) throw new Error('Not on Amazon');
    await ensureContentScriptInjected(tab.id);
    const response = await chrome.tabs.sendMessage(tab.id, { action: 'getProductTitle' });
    if (response?.error) throw new Error(response.error);
    return response?.title ?? null;
  }

  async function getProductInfo() {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!tab?.url?.includes('amazon.com')) throw new Error('Not on Amazon');
    await ensureContentScriptInjected(tab.id);
    const response = await chrome.tabs.sendMessage(tab.id, { action: 'getProductInfo' });
    if (response?.error) throw new Error(response.error);
    return response?.productInfo ?? null;
  }

  async function getProductId() {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    const url = tab?.url || '';
    const dpMatch = url.match(/\/dp\/([A-Z0-9]{10})/);
    if (dpMatch?.[1]) return dpMatch[1];
    const asinMatch = url.match(/[?&]asin=([A-Z0-9]{10})/);
    if (asinMatch?.[1]) return asinMatch[1];
    const { asinOrTabId } = await getAsinOrTabId();
    if (typeof asinOrTabId === 'string' && /^[A-Z0-9]{10}$/.test(asinOrTabId)) return asinOrTabId;
    return null;
  }

  async function openAmazonReviewPage() {
    const productId = await getProductId();
    if (!productId) {
      displayError('Could not extract product ID from URL');
      return;
    }
    const reviewText = reviewOutputDiv.value;
    const reviewTitle = reviewTitleDiv.value;
    const fullReviewText = `Title: ${reviewTitle}\n\nReview: ${reviewText}`;
    await saveToStorage('review', fullReviewText);
    const reviewUrl = `https://www.amazon.com/review/review-your-purchases/?asin=${productId}`;
    const newTab = await chrome.tabs.create({ url: reviewUrl });
    let attempts = 0;
    const maxAttempts = 3;
    const tryFillReview = async () => {
      try {
        await chrome.scripting.executeScript({
          target: { tabId: newTab.id },
          files: ['review-page.js'],
        });
        const response = await chrome.tabs.sendMessage(newTab.id, {
          action: 'fillReviewTextarea',
          reviewText: fullReviewText,
        });
        if (!response?.success) throw new Error('Failed to fill review form');
      } catch (error) {
        console.error('Error filling review form:', error);
        attempts++;
        if (attempts < maxAttempts) setTimeout(tryFillReview, 1000 * attempts);
        else displayError('Failed to fill review form after multiple attempts');
      }
    };
    setTimeout(tryFillReview, 1000);
  }

  function updateWriteReviewButtonState(hasReview) {
    writeReviewButton.style.display = hasReview ? 'block' : 'none';
    writeReviewButton.disabled = !hasReview;
  }

  async function saveToStorage(key, data) {
    try {
      const { asinOrTabId, isTabFallback } = await getAsinOrTabId();
      const storageKey = getStorageKey(key, asinOrTabId);
      await chrome.storage.local.set({ [storageKey]: data });
      if (isTabFallback) {
        statusDiv.textContent = 'Saved for this tab (product ID not detected).';
        statusDiv.className = 'success';
      }
    } catch (error) {
      console.error('Error saving to storage:', error);
    }
  }

  async function getFromStorage(key) {
    try {
      const { asinOrTabId } = await getAsinOrTabId();
      const storageKey = getStorageKey(key, asinOrTabId);
      const result = await chrome.storage.local.get(storageKey);
      return result[storageKey] ?? null;
    } catch (error) {
      console.error('Error getting from storage:', error);
      return null;
    }
  }

  function showLoading() {
    regenerateReviewButton.classList.add('spinning');
    regenerateReviewButton.disabled = true;
    reviewOutputDiv.value = '';
    reviewTitleDiv.value = '';
    copyButton.style.display = 'none';
    copyTitleButton.style.display = 'none';
    writeReviewButton.style.display = 'none';
  }

  function hideLoading() {
    regenerateReviewButton.classList.remove('spinning');
    regenerateReviewButton.disabled = false;
  }

  function displayError(message) {
    statusDiv.textContent = message;
    statusDiv.className = 'error';
  }

  function updatePersonaFields(persona) {
    if (!persona) return;
    personaAgeInput.value = persona.age ?? '';
    personaGenderInput.value = persona.gender ?? '';
    personaOccupationInput.value = persona.occupation ?? '';
    personaDescriptionInput.value = persona.description ?? '';
  }

  function getCurrentPersona() {
    return {
      age: parseInt(personaAgeInput.value, 10) || 0,
      gender: (personaGenderInput.value || '').trim(),
      occupation: (personaOccupationInput.value || '').trim(),
      description: (personaDescriptionInput.value || '').trim(),
    };
  }

  function updateAspectsDisplay(aspects) {
    if (!aspects || !Array.isArray(aspects) || aspects.length === 0) {
      aspectsContainer.innerHTML = '<span class="aspect-tag">No aspects</span>';
      return;
    }
    aspectsContainer.innerHTML = '';
    aspects.forEach((a) => {
      const el = document.createElement('span');
      el.className = 'aspect-tag';
      el.textContent = a;
      aspectsContainer.appendChild(el);
    });
    currentAspects = aspects;
  }

  function normalizeDashes(str) {
    if (!str || typeof str !== 'string') return str;
    return str
      .replace(/\b([a-zA-Z]+)-([a-zA-Z]+)\b/g, '$1 $2')
      .replace(/—/g, ', ')
      .replace(/\s*-\s*/g, ', ')
      .replace(/,\s*,/g, ',');
  }

  function parseReviewText(text, fallbackTitle = '') {
    let title = fallbackTitle || 'Product Review';
    let review = text || '';
    try {
      try {
        const parsed = JSON.parse(text);
        if (parsed && typeof parsed === 'object') {
          if (typeof parsed.title === 'string') title = parsed.title.trim();
          if (typeof parsed.review === 'string') review = parsed.review.trim();
          return { title: normalizeDashes(title), review: normalizeDashes(review) };
        }
      } catch (_) {}
      const titleMatch = text.match(/Title:\s*([^\n]+)/i);
      const reviewMatch = text.match(/Review:\s*([\s\S]+?)(?=\n\nTitle:|$)/i);
      if (titleMatch && reviewMatch) {
        title = titleMatch[1].trim();
        review = reviewMatch[1].trim();
      } else {
        const paragraphs = text.split('\n\n').filter((p) => p.trim());
        if (paragraphs.length >= 2) {
          review = paragraphs[0].trim();
          title = paragraphs[1].trim();
        } else if (paragraphs.length === 1) review = paragraphs[0].trim();
      }
      review = review.replace(/^Review:\s*/i, '').trim();
      return { title: normalizeDashes(title), review: normalizeDashes(review) };
    } catch (_) {
      return { title: 'Product Review', review: normalizeDashes(text) };
    }
  }

  async function generateAspects() {
    regenerateAspectsButton.classList.add('spinning');
    regenerateAspectsButton.disabled = true;
    try {
      statusDiv.textContent = '';
      statusDiv.className = '';
      let productInfo = await getFromStorage('productInfo');
      if (!productInfo) {
        productInfo = await getProductInfo();
        if (!productInfo) throw new Error('Could not fetch product information');
        await saveToStorage('productInfo', productInfo);
      }
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
      if (!tab?.url?.includes('amazon.com')) throw new Error('Please navigate to an Amazon product page');
      await ensureContentScriptInjected(tab.id);
      const response = await chrome.tabs.sendMessage(tab.id, { action: 'generateAspects', productInfo });
      if (response?.error) throw new Error(response.error);
      const aspects = response.aspects;
      await saveToStorage('aspects', aspects);
      updateAspectsDisplay(aspects);
      statusDiv.textContent = 'Key aspects generated.';
      statusDiv.className = 'success';
    } catch (error) {
      displayError(error?.message || 'Failed to generate aspects');
    } finally {
      regenerateAspectsButton.classList.remove('spinning');
      regenerateAspectsButton.disabled = false;
    }
  }

  async function generatePersona() {
    regeneratePersonaButton.classList.add('spinning');
    regeneratePersonaButton.disabled = true;
    try {
      statusDiv.textContent = '';
      statusDiv.className = '';
      let productInfo = await getFromStorage('productInfo');
      if (!productInfo) {
        productInfo = await getProductInfo();
        if (!productInfo) throw new Error('Could not fetch product information');
        await saveToStorage('productInfo', productInfo);
      }
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
      if (!tab?.url?.includes('amazon.com')) throw new Error('Please navigate to an Amazon product page');
      await ensureContentScriptInjected(tab.id);
      const response = await chrome.tabs.sendMessage(tab.id, { action: 'generatePersona', productInfo });
      if (response?.error) throw new Error(response.error);
      const persona = response.persona;
      await saveToStorage('persona', persona);
      updatePersonaFields(persona);
      statusDiv.textContent = 'Persona generated.';
      statusDiv.className = 'success';
    } catch (error) {
      displayError(error?.message || 'Failed to generate persona');
    } finally {
      regeneratePersonaButton.classList.remove('spinning');
      regeneratePersonaButton.disabled = false;
    }
  }

  async function generateReview() {
    try {
      showLoading();
      statusDiv.textContent = 'Generating review...';
      statusDiv.className = '';
      let productInfo = await getFromStorage('productInfo');
      if (!productInfo) {
        productInfo = await getProductInfo();
        if (!productInfo) throw new Error('Could not fetch product information');
        await saveToStorage('productInfo', productInfo);
      }
      const persona = getCurrentPersona();
      const aspects = currentAspects;
      const finalExtraDirections =
        aspects?.length > 0
          ? `Please focus on these key aspects in your review: ${aspects.join(', ')}.`
          : '';

      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
      if (!tab?.url?.includes('amazon.com')) throw new Error('Please navigate to an Amazon product page');
      await ensureContentScriptInjected(tab.id);
      const response = await chrome.tabs.sendMessage(tab.id, {
        action: 'generateReview',
        productInfo,
        persona,
        extraDirections: finalExtraDirections,
      });
      if (response?.error) throw new Error(response.error);
      const reviewText = response.formattedText || response.review || '';
      const titleFromResponse = response.title || '';
      const { title, review } = parseReviewText(reviewText, titleFromResponse);
      const normalizedText = `Title: ${title}\n\nReview: ${review}`;
      await saveToStorage('review', normalizedText);
      reviewOutputDiv.value = review;
      reviewTitleDiv.value = title;
      copyButton.style.display = 'block';
      copyTitleButton.style.display = 'block';
      updateWriteReviewButtonState(true);
      statusDiv.textContent = 'Review generated.';
      statusDiv.className = 'success';
    } catch (error) {
      displayError(error?.message || 'Failed to generate review');
      updateWriteReviewButtonState(false);
    } finally {
      hideLoading();
    }
  }

  writeReviewButton.addEventListener('click', () => openAmazonReviewPage());

  copyButton.addEventListener('click', () => {
    navigator.clipboard.writeText(reviewOutputDiv.value).then(() => {
      const t = copyButton.textContent;
      copyButton.textContent = 'Copied!';
      setTimeout(() => { copyButton.textContent = t; }, 2000);
    });
  });
  copyTitleButton.addEventListener('click', () => {
    navigator.clipboard.writeText(reviewTitleDiv.value).then(() => {
      const t = copyTitleButton.textContent;
      copyTitleButton.textContent = 'Copied!';
      setTimeout(() => { copyTitleButton.textContent = t; }, 2000);
    });
  });
  regeneratePersonaButton.addEventListener('click', () => generatePersona());
  regenerateAspectsButton.addEventListener('click', () => generateAspects());
  regenerateReviewButton.addEventListener('click', () => generateReview());

  tabMain.addEventListener('click', () => {
    tabMain.classList.add('active');
    tabSettings.classList.remove('active');
    panelMain.classList.add('active');
    panelSettings.classList.remove('active');
  });
  tabSettings.addEventListener('click', () => {
    tabSettings.classList.add('active');
    tabMain.classList.remove('active');
    panelSettings.classList.add('active');
    panelMain.classList.remove('active');
    refreshSettingsModelOptions();
  });

  function refreshSettingsModelOptions() {
    const provider = settingsProvider.value;
    const models = MODEL_OPTIONS[provider] || [];
    settingsModel.innerHTML = '';
    models.forEach((m) => {
      const opt = document.createElement('option');
      opt.value = m.id;
      opt.textContent = m.label;
      settingsModel.appendChild(opt);
    });
  }

  async function loadSettings() {
    let raw = await chrome.storage.sync.get('settings');
    let s = raw.settings || {};
    if (!s.model && !s.provider) {
      const localRaw = await chrome.storage.local.get('settings');
      const local = localRaw.settings || {};
      if (local.model || local.provider) {
        s = { provider: local.provider || 'openrouter', model: local.model || 'anthropic/claude-haiku-4.5' };
        await chrome.storage.sync.set({ settings: s });
      }
    }
    const provider = s.provider || 'openrouter';
    const model = s.model || 'anthropic/claude-haiku-4.5';
    settingsProvider.value = provider;
    refreshSettingsModelOptions();
    settingsModel.value = model;
    if (!settingsModel.value && MODEL_OPTIONS[provider]?.length) settingsModel.value = MODEL_OPTIONS[provider][0].id;
    updateCurrentModelLabel();
  }

  function updateCurrentModelLabel() {
    const provider = settingsProvider.value;
    const modelId = settingsModel.value;
    const models = MODEL_OPTIONS[provider] || [];
    const option = models.find((m) => m.id === modelId);
    const label = option?.label ?? modelId;
    if (currentModelLabel) currentModelLabel.textContent = 'Model: ' + label;
  }

  settingsProvider.addEventListener('change', refreshSettingsModelOptions);
  settingsProvider.addEventListener('change', async () => {
    const provider = settingsProvider.value;
    const model = settingsModel.value;
    await chrome.storage.sync.set({ settings: { provider, model } });
    updateCurrentModelLabel();
  });
  settingsModel.addEventListener('change', async () => {
    const provider = settingsProvider.value;
    const model = settingsModel.value;
    await chrome.storage.sync.set({ settings: { provider, model } });
    updateCurrentModelLabel();
  });
  settingsSave.addEventListener('click', async () => {
    const provider = settingsProvider.value;
    const model = settingsModel.value;
    await chrome.storage.sync.set({ settings: { provider, model } });
    updateCurrentModelLabel();
    settingsStatus.textContent = 'Settings saved.';
    settingsStatus.className = 'success';
  });

  async function checkAndLoadPersona() {
    try {
      const storedPersona = await getFromStorage('persona');
      if (storedPersona?.age && storedPersona?.gender && storedPersona?.occupation && storedPersona?.description) {
        updatePersonaFields(storedPersona);
        personaLoaded = true;
        return true;
      }
      await generatePersona();
      personaLoaded = true;
      return false;
    } catch (_) {
      await generatePersona();
      personaLoaded = true;
      return false;
    }
  }

  async function checkAndLoadAspects() {
    try {
      const storedAspects = await getFromStorage('aspects');
      if (storedAspects?.length > 0) {
        updateAspectsDisplay(storedAspects);
        aspectsLoaded = true;
        return true;
      }
      await generateAspects();
      aspectsLoaded = true;
      return false;
    } catch (_) {
      await generateAspects();
      aspectsLoaded = true;
      return false;
    }
  }

  async function checkAndAutoGenerateReview() {
    if (aspectsLoaded && personaLoaded) {
      const storedReview = await getFromStorage('review');
      if (!storedReview) await generateReview();
    }
  }

  async function refreshPanelContent() {
    aspectsLoaded = false;
    personaLoaded = false;
    try {
      await loadSettings();
      const isAmazonPage = await checkAmazonPage();
      if (isAmazonPage) {
        const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
        await ensureContentScriptInjected(tab.id);
        const asin = (await getAsinOrTabId()).asinOrTabId;
        const isAsin = typeof asin === 'string' && /^[A-Z0-9]{10}$/.test(asin);
        if (isAsin) {
          const storedReview = await getFromStorage('review');
          if (storedReview) {
            const { title, review } = parseReviewText(storedReview);
            reviewOutputDiv.value = review;
            reviewTitleDiv.value = title;
            copyButton.style.display = 'block';
            copyTitleButton.style.display = 'block';
            updateWriteReviewButtonState(true);
            statusDiv.textContent = 'Review loaded from storage.';
            statusDiv.className = 'success';
          } else {
            updateWriteReviewButtonState(false);
          }
          await checkAndLoadPersona();
          await checkAndLoadAspects();
          if (!storedReview) await checkAndAutoGenerateReview();
        } else {
          const title = await getProductTitle();
          if (title) {
            productTitleDiv.textContent = title;
            await checkAndLoadAspects();
            await checkAndLoadPersona();
            await checkAndAutoGenerateReview();
          } else {
            productTitleDiv.textContent = 'Could not get product title';
            productTitleDiv.style.color = 'red';
          }
        }
        if (!isAsin) {
          productTitleDiv.textContent = productTitleDiv.textContent || 'Could not get product ID from URL';
          if (!productTitleDiv.textContent.includes('product')) productTitleDiv.style.color = 'red';
        }
      }
    } catch (error) {
      console.error('Init error:', error);
      productTitleDiv.textContent = 'Error: ' + (error?.message || 'Unknown');
      productTitleDiv.style.color = 'red';
    }
  }

  chrome.runtime.onMessage.addListener((request) => {
    if (request.action === 'refreshPanel') refreshPanelContent();
  });

  await refreshPanelContent();
});
