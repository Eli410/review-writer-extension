/**
 * Popup orchestrator. All LLM work is requested from the background service
 * worker directly (single hop). The content script is only used to scrape the
 * page. Storage is batched and keyed by ASIN (falls back to tab ID on pages
 * without one).
 */
document.addEventListener('DOMContentLoaded', async () => {
  const el = {
    status: document.getElementById('status'),
    productTitle: document.getElementById('productTitle'),
    reviewOutput: document.getElementById('reviewOutput'),
    reviewTitle: document.getElementById('reviewTitle'),
    aspectsContainer: document.getElementById('aspectsContainer'),
    personaAge: document.getElementById('personaAge'),
    personaGender: document.getElementById('personaGender'),
    personaOccupation: document.getElementById('personaOccupation'),
    personaDescription: document.getElementById('personaDescription'),
    writeReview: document.getElementById('writeReview'),
    copyButton: document.getElementById('copyReview'),
    copyTitleButton: document.getElementById('copyTitle'),
    busyButtons: {
      review: document.getElementById('regenerateReview'),
      persona: document.getElementById('regeneratePersona'),
      aspects: document.getElementById('regenerateAspects'),
    },
    settingsProvider: document.getElementById('settingsProvider'),
    settingsModel: document.getElementById('settingsModel'),
    settingsApiKey: document.getElementById('settingsApiKey'),
    settingsApiKeySave: document.getElementById('settingsApiKeySave'),
    settingsKeyTest: document.getElementById('settingsKeyTest'),
    settingsSave: document.getElementById('settingsSave'),
    settingsStatus: document.getElementById('settingsStatus'),
    currentModelLabel: document.getElementById('currentModelLabel'),
  };

  const models = PROVIDER_CONFIG?.openrouter?.models || [];
  const defaultModel = PROVIDER_CONFIG?.openrouter?.defaultModel || models[0]?.id;

  // Per-open context, resolved once in init().
  const ctx = {
    tabId: null,
    url: '',
    asinOrTabId: null,
    isProductPage: false,
  };

  // ------------------------------------------------------------- plumbing

  const asinOrTabId = () => ctx.asinOrTabId ?? ctx.tabId;

  async function loadStored(names) {
    const suffix = asinOrTabId();
    if (suffix == null) return {};
    const keys = names.map((name) => getStorageKey(name, suffix));
    try {
      const result = await chrome.storage.local.get(keys);
      const out = {};
      for (const name of names) out[name] = result[getStorageKey(name, suffix)] ?? null;
      return out;
    } catch (error) {
      console.error('Storage read failed:', error);
      return {};
    }
  }

  async function saveStored(map) {
    const suffix = asinOrTabId();
    if (suffix == null || !map || Object.keys(map).length === 0) return;
    const payload = {};
    for (const [name, value] of Object.entries(map)) {
      payload[getStorageKey(name, suffix)] = value;
    }
    try {
      await chrome.storage.local.set(payload);
    } catch (error) {
      console.error('Storage write failed:', error);
    }
  }

  async function getActiveTab() {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    ctx.tabId = tab?.id ?? null;
    ctx.url = tab?.url || '';
    return tab;
  }

  async function ensureContentScriptInjected(tabId) {
    try {
      const ping = await chrome.tabs.sendMessage(tabId, { action: 'ping' });
      if (ping?.status === 'ok') return true;
    } catch (_) {}
    await chrome.scripting.executeScript({ target: { tabId }, files: ['content.js'] });
    for (let i = 0; i < 5; i++) {
      await new Promise((r) => setTimeout(r, 150));
      try {
        const ping = await chrome.tabs.sendMessage(tabId, { action: 'ping' });
        if (ping?.status === 'ok') return true;
      } catch (_) {}
    }
    throw new Error('Could not connect to the page. Refresh it and try again.');
  }

  async function scrapeProductInfo() {
    if (!ctx.isProductPage) throw new Error('Please navigate to an Amazon product page.');
    await ensureContentScriptInjected(ctx.tabId);
    const response = await chrome.tabs.sendMessage(ctx.tabId, { action: 'getProductInfo' });
    if (chrome.runtime.lastError) throw new Error('Could not read the product page.');
    const productInfo = response?.productInfo;
    if (!productInfo?.title) throw new Error('Could not read product details from this page.');
    return productInfo;
  }

  // ------------------------------------------------------------------ UI

  function setStatus(kind, message) {
    el.status.textContent = message || '';
    el.status.className = kind || '';
  }

  function withButton(name, busy) {
    const button = el.busyButtons[name];
    if (!button) return;
    button.classList.toggle('spinning', busy);
    button.disabled = busy;
  }

  function showReview(title, review) {
    el.reviewTitle.value = title || '';
    el.reviewOutput.value = review || '';
    el.copyButton.style.display = 'block';
    el.copyTitleButton.style.display = 'block';
    el.writeReview.style.display = 'block';
    el.writeReview.disabled = !review;
  }

  function hideReview() {
    el.reviewOutput.value = '';
    el.reviewTitle.value = '';
    el.copyButton.style.display = 'none';
    el.copyTitleButton.style.display = 'none';
    el.writeReview.style.display = 'none';
  }

  function updatePersonaFields(persona) {
    if (!persona) return;
    el.personaAge.value = persona.age ?? '';
    el.personaGender.value = persona.gender ?? '';
    el.personaOccupation.value = persona.occupation ?? '';
    el.personaDescription.value = persona.description ?? '';
  }

  function currentPersonaFieldsFilled() {
    return Boolean(
      el.personaAge.value &&
      el.personaGender.value.trim() &&
      el.personaOccupation.value.trim() &&
      el.personaDescription.value.trim(),
    );
  }

  function currentPersona() {
    return {
      age: parseInt(el.personaAge.value, 10) || 0,
      gender: el.personaGender.value.trim(),
      occupation: el.personaOccupation.value.trim(),
      description: el.personaDescription.value.trim(),
    };
  }

  let currentAspects = [];

  function updateAspectsDisplay(aspects) {
    if (!Array.isArray(aspects) || aspects.length === 0) {
      el.aspectsContainer.innerHTML = '<span class="aspect-tag">No aspects</span>';
      currentAspects = [];
      return;
    }
    el.aspectsContainer.innerHTML = '';
    for (const aspect of aspects) {
      const tag = document.createElement('span');
      tag.className = 'aspect-tag';
      tag.textContent = aspect;
      el.aspectsContainer.appendChild(tag);
    }
    currentAspects = aspects;
  }

  // LLM access: popup → background. The response is raw assistant text;
  // callers own parsing/validation via the shared parseJsonFromLLM helper.
  async function llm(task, userPrompt) {
    let response;
    try {
      response = await chrome.runtime.sendMessage({ action: 'llmComplete', task, userPrompt });
    } catch (error) {
      throw new Error('Background service worker is unavailable. Reload the extension and try again.');
    }
    if (response?.error) throw new Error(response.error);
    if (!response?.text) throw new Error('Empty response from the model. Try again.');
    return response.text;
  }

  const ASPECT_LIMIT = 5;

  function normalizeAspects(aspects) {
    if (!Array.isArray(aspects)) return null;
    const strings = aspects.filter((a) => typeof a === 'string' && a.trim()).map((a) => {
      const words = a.trim().split(/\s+/);
      return words.length <= 2 ? words.join(' ') : words.slice(0, 2).join(' ');
    });
    return strings.length >= 2 ? strings.slice(0, ASPECT_LIMIT) : null;
  }

  function normalizePersona(persona) {
    if (!persona || typeof persona !== 'object') return null;
    const age = Number(persona.age);
    const gender = typeof persona.gender === 'string' ? persona.gender.trim() : '';
    const occupation = typeof persona.occupation === 'string' ? persona.occupation.trim() : '';
    const description = typeof persona.description === 'string' ? persona.description.trim() : '';
    if (!Number.isFinite(age) || age < 13 || age > 110 || !gender || !occupation) return null;
    return { age: Math.round(age), gender, occupation, description: description.slice(0, 200) };
  }

  function normalizeReviewResult(parsed) {
    const title = typeof parsed?.title === 'string' && parsed.title.trim() ? parsed.title.trim() : null;
    const review = typeof parsed?.review === 'string' && parsed.review.trim() ? parsed.review.trim() : null;
    if (!title || !review) return null;
    return { title: normalizeDashes(title), review: normalizeDashes(review) };
  }

  // ------------------------------------------------------------ generation

  async function generatePersona({ productInfo } = {}) {
    let info = productInfo;
    if (!info) info = (await loadStored(['productInfo'])).productInfo;
    if (!info) {
      info = await scrapeProductInfo();
      await saveStored({ productInfo: info });
    }
    const persona = normalizePersona(parseJsonFromLLM(await llm('persona', buildPersonaPrompt(info))));
    if (!persona) throw new Error('The model returned a persona in an unexpected format. Try regenerating.');
    await saveStored({ persona });
    updatePersonaFields(persona);
    return persona;
  }

  async function generateAspects({ productInfo } = {}) {
    let info = productInfo;
    if (!info) info = (await loadStored(['productInfo'])).productInfo;
    if (!info) {
      info = await scrapeProductInfo();
      await saveStored({ productInfo: info });
    }
    const aspects = normalizeAspects(parseJsonFromLLM(await llm('aspects', buildAspectsPrompt(info))));
    if (!aspects) throw new Error('The model returned aspects in an unexpected format. Try regenerating.');
    await saveStored({ aspects });
    updateAspectsDisplay(aspects);
    return aspects;
  }

  /**
   * Ensure a persona exists. Uses edited fields when present so manual edits
   * are respected; regenerates only when everything is empty.
   */
  async function ensurePersona() {
    if (currentPersonaFieldsFilled()) return currentPersona();
    return generatePersona();
  }

  async function generateReview() {
    const persona = await ensurePersona();
    let info = (await loadStored(['productInfo'])).productInfo;
    if (!info) {
      info = await scrapeProductInfo();
      await saveStored({ productInfo: info });
    }
    const text = await llm('review', buildReviewPrompt(info, persona, currentAspects));
    const parsed = normalizeReviewResult(parseJsonFromLLM(text));
    if (!parsed) throw new Error('The model returned the review in an unexpected format. Try regenerating.');
    await saveStored({ review: `Title: ${parsed.title}\n\nReview: ${parsed.review}` });
    showReview(parsed.title, parsed.review);
    return parsed;
  }

  /**
   * One combined call when a product has nothing stored yet: persona +
   * aspects + review together. Missing pieces fall back to single-task calls.
   */
  async function generateFull(productInfo) {
    const text = await llm('full', buildFullPrompt(productInfo));
    const parsed = parseJsonFromLLM(text);
    const review = normalizeReviewResult(parsed?.review);
    if (!review) {
      throw new Error('The model returned the combined result in an unexpected format. Try regenerating.');
    }

    const persona = normalizePersona(parsed?.persona);
    const aspects = normalizeAspects(parsed?.aspects);
    const toSave = { review: `Title: ${review.title}\n\nReview: ${review.review}` };
    if (persona) {
      updatePersonaFields(persona);
      toSave.persona = persona;
    }
    if (aspects) {
      updateAspectsDisplay(aspects);
      toSave.aspects = aspects;
    }
    await saveStored(toSave);
    showReview(review.title, review.review);
    return { persona: Boolean(persona), aspects: Boolean(aspects) };
  }

  async function regenerate(kind) {
    withButton(kind, true);
    setStatus('', 'Generating…');
    try {
      if (kind === 'persona') {
        await generatePersona();
        setStatus('success', 'Persona generated.');
      } else if (kind === 'aspects') {
        await generateAspects();
        setStatus('success', 'Key aspects generated.');
      } else {
        await generateReview();
        setStatus('success', 'Review generated.');
      }
    } catch (error) {
      setStatus('error', error?.message || `Failed to regenerate ${kind}.`);
    } finally {
      withButton(kind, false);
    }
  }

  // ------------------------------------------------------------ init flow

  function isSupportedAmazonUrl(url) {
    if (!/\.amazon\./.test(url)) return { ok: false, reason: 'not-amazon' };
    if (!/\/dp\/|\/review\/review-your-purchases\//.test(url)) {
      return { ok: false, reason: 'not-product' };
    }
    return { ok: true };
  }

  async function loadSettings() {
    let model;
    try {
      const { settings } = await chrome.storage.sync.get('settings');
      model = settings?.model;
    } catch (_) {}
    if (!models.some((m) => m.id === model)) model = defaultModel; // drop obsolete ids

    el.settingsProvider.value = 'openrouter';
    el.settingsModel.innerHTML = '';
    for (const m of models) {
      const option = document.createElement('option');
      option.value = m.id;
      option.textContent = m.label;
      el.settingsModel.appendChild(option);
    }
    el.settingsModel.value = model || defaultModel;
    if (el.settingsModel.value !== model) {
      await chrome.storage.sync.set({ settings: { provider: 'openrouter', model: el.settingsModel.value } });
    }
    updateCurrentModelLabel();

    try {
      const { openrouterApiKey } = await chrome.storage.local.get('openrouterApiKey');
      el.settingsApiKey.placeholder = openrouterApiKey
        ? 'Key saved'
        : 'Leave empty to use .env fallback';
    } catch (_) {}
  }

  function updateCurrentModelLabel() {
    const option = models.find((m) => m.id === el.settingsModel.value);
    if (el.currentModelLabel) {
      el.currentModelLabel.textContent = `Model: ${option?.label ?? el.settingsModel.value ?? ''}`;
    }
  }

  async function refreshPanelContent() {
    await loadSettings();

    const path = isSupportedAmazonUrl(ctx.url);
    if (!path.ok) {
      el.productTitle.textContent = path.reason === 'not-amazon'
        ? 'Please navigate to an Amazon product page'
        : 'Please navigate to an Amazon product or review page';
      el.productTitle.style.color = 'red';
      return;
    }
    ctx.isProductPage = true;

    const suffix = extractAsin(ctx.url) ?? ctx.tabId;
    ctx.asinOrTabId = suffix;
    const stored = await loadStored(['productInfo', 'persona', 'aspects', 'review']);

    // Show remembered state immediately.
    if (stored.review) {
      const { title, review } = parseReviewText(stored.review);
      showReview(title, review);
      setStatus('success', 'Review loaded from storage.');
    } else {
      hideReview();
    }
    updatePersonaFields(stored.persona);
    updateAspectsDisplay(stored.aspects);

    // Need product info for the prompt; prefer the stored copy.
    let productInfo = stored.productInfo;
    if (!productInfo) {
      setStatus('', 'Reading product page…');
      try {
        productInfo = await scrapeProductInfo();
        await saveStored({ productInfo });
        if (stored.review) setStatus('success', 'Review loaded from storage.');
      } catch (error) {
        el.productTitle.textContent = error.message;
        el.productTitle.style.color = 'red';
        setStatus('error', 'Could not read product details. Try again after reloading the page.');
        return;
      }
    }
    if (productInfo?.title) {
      el.productTitle.textContent = productInfo.title;
      el.productTitle.style.color = '#1a1a1a';
    }

    // Nothing stored → single combined call. Otherwise only fill remembered
    // gaps; never re-generate persona/aspects from scratch on every open.
    if (!stored.review && !stored.persona && !stored.aspects) {
      try {
        setStatus('', 'Generating persona, aspects, and review…');
        await generateFull(productInfo);
        setStatus('success', 'Review generated.');
        return;
      } catch (error) {
        setStatus('error', error?.message || 'Generation failed.');
        return;
      }
    }

    // Partial state (e.g. persona stored but review missing): fill just the
    // missing review; missing persona/aspects stay filled lazily by the
    // regenerate handlers when needed.
    if (!stored.review) {
      try {
        setStatus('', 'Generating review…');
        await generateReview();
        setStatus('success', 'Review generated.');
      } catch (error) {
        setStatus('error', error?.message || 'Generation failed.');
      }
    }
  }

  async function init() {
    try {
      await getActiveTab();
      await refreshPanelContent();
    } catch (error) {
      console.error('Init error:', error);
      el.productTitle.textContent = `Error: ${error?.message || 'Unknown'}`;
      el.productTitle.style.color = 'red';
    }
  }

  // ------------------------------------------------------------ write flow

  async function openAmazonReviewPage() {
    const productId = ctx.asinOrTabId && /^[A-Z0-9]{10}$/.test(String(ctx.asinOrTabId))
      ? String(ctx.asinOrTabId)
      : extractAsin(ctx.url) || null;
    if (!productId) {
      setStatus('error', 'Could not determine the product ID. Open this from a product page.');
      return;
    }
    const reviewText = el.reviewOutput.value.trim();
    const reviewTitle = el.reviewTitle.value.trim();
    if (!reviewText) {
      setStatus('error', 'Generate or write a review first.');
      return;
    }
    const fullReviewText = `Title: ${reviewTitle}\n\nReview: ${reviewText}`;
    await saveStored({ review: fullReviewText });

    const reviewUrl = `https://www.amazon.com/review/review-your-purchases/?asin=${productId}`;
    try {
      const newTab = await chrome.tabs.create({ url: reviewUrl });
      // review-page.js auto-runs on that page; also poke it after load in case
      // the auto-run raced the form. It senses no pre-filled text via message.
      setTimeout(() => {
        chrome.tabs.sendMessage(newTab.id, { action: 'fillReviewTextarea', reviewText: fullReviewText })
          .catch(() => {});
      }, 2500);
    } catch (error) {
      setStatus('error', `Could not open the review page: ${error?.message || 'unknown'}`);
    }
  }

  // ------------------------------------------------------------- settings

  el.settingsModel.addEventListener('change', async () => {
    await chrome.storage.sync.set({
      settings: { provider: el.settingsProvider.value, model: el.settingsModel.value },
    });
    updateCurrentModelLabel();
  });

  el.settingsSave.addEventListener('click', async () => {
    await chrome.storage.sync.set({
      settings: { provider: el.settingsProvider.value, model: el.settingsModel.value },
    });
    updateCurrentModelLabel();
    el.settingsStatus.textContent = 'Settings saved.';
    el.settingsStatus.className = 'success';
  });

  el.settingsApiKeySave.addEventListener('click', async () => {
    const apiKey = el.settingsApiKey.value.trim();
    try {
      if (apiKey) await chrome.storage.local.set({ openrouterApiKey: apiKey });
      else await chrome.storage.local.remove('openrouterApiKey');
      el.settingsApiKey.value = '';
      el.settingsApiKey.placeholder = apiKey ? 'Key saved' : 'Leave empty to use .env fallback';
      el.settingsStatus.textContent = apiKey ? 'API key saved.' : 'API key removed (falls back to .env).';
      el.settingsStatus.className = 'success';
    } catch (error) {
      el.settingsStatus.textContent = `Could not save key: ${error?.message || 'unknown'}`;
      el.settingsStatus.className = 'error';
    }
  });

  el.settingsKeyTest.addEventListener('click', async () => {
    const apiKey = el.settingsApiKey.value.trim() || null; // null → test the stored one
    el.settingsKeyTest.disabled = true;
    el.settingsStatus.textContent = 'Testing key…';
    el.settingsStatus.className = '';
    try {
      const response = await chrome.runtime.sendMessage({ action: 'testKey', apiKey });
      if (response?.ok) {
        el.settingsStatus.textContent = `Key OK${response.summary ? ` — ${response.summary}` : ''}.`;
        el.settingsStatus.className = 'success';
        if (apiKey) await chrome.storage.local.set({ openrouterApiKey: apiKey });
      } else {
        el.settingsStatus.textContent = response?.error || 'Key check failed.';
        el.settingsStatus.className = 'error';
      }
    } catch (error) {
      el.settingsStatus.textContent = error?.message || 'Key check failed.';
      el.settingsStatus.className = 'error';
    } finally {
      el.settingsKeyTest.disabled = false;
    }
  });

  // --------------------------------------------------------------- wiring

  el.busyButtons.review.addEventListener('click', () => regenerate('review'));
  el.busyButtons.persona.addEventListener('click', () => regenerate('persona'));
  el.busyButtons.aspects.addEventListener('click', () => regenerate('aspects'));
  el.writeReview.addEventListener('click', () => openAmazonReviewPage());

  document.getElementById('tabMain').addEventListener('click', () => switchTab('main'));
  document.getElementById('tabSettings').addEventListener('click', () => switchTab('settings'));
  function switchTab(which) {
    const mainTab = document.getElementById('tabMain');
    const settingsTab = document.getElementById('tabSettings');
    const mainPanel = document.getElementById('panelMain');
    const settingsPanel = document.getElementById('panelSettings');
    mainTab.classList.toggle('active', which === 'main');
    settingsTab.classList.toggle('active', which === 'settings');
    mainPanel.classList.toggle('active', which === 'main');
    settingsPanel.classList.toggle('active', which === 'settings');
  }

  function copyFlow(source, button) {
    const original = button.textContent;
    navigator.clipboard.writeText(source.value).then(() => {
      button.textContent = 'Copied!';
      setTimeout(() => { button.textContent = original; }, 2000);
    }).catch(() => setStatus('error', 'Copy failed.'));
  }
  el.copyButton.addEventListener('click', () => copyFlow(el.reviewOutput, el.copyButton));
  el.copyTitleButton.addEventListener('click', () => copyFlow(el.reviewTitle, el.copyTitleButton));

  await init();
});
