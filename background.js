importScripts('config.js');

/**
 * Background service worker. Owns everything that talks to OpenRouter:
 * API key resolution, request/retry/timeout handling, error mapping, and the
 * system prompt from prompt.txt. Content scripts and the popup never touch the
 * network themselves.
 */

const OPENROUTER_CHAT_URL = 'https://openrouter.ai/api/v1/chat/completions';
const OPENROUTER_KEY_URL = 'https://openrouter.ai/api/v1/key';
const REQUEST_TIMEOUT_MS = 45000;
const MAX_RETRIES = 2; // extra attempts after the first
const RETRY_BASE_DELAY_MS = 600;

const _envCache = {};
const _promptCache = {};
let _apiKeyMemo = null;

// ---------------------------------------------------------------- utilities

/**
 * Parse a .env file body into a plain object. Tolerates blank lines, comments,
 * `export` prefixes, and single/double quoted values.
 */
function parseDotEnv(envText) {
  const result = {};
  for (const rawLine of String(envText || '').split(/\r?\n/)) {
    const line = rawLine.trim().replace(/^export\s+/, '');
    if (!line || line.startsWith('#')) continue;
    const eq = line.indexOf('=');
    if (eq === -1) continue;
    const key = line.slice(0, eq).trim();
    let value = line.slice(eq + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    result[key] = value;
  }
  return result;
}

async function fetchWithTimeout(url, options = {}, timeoutMs = REQUEST_TIMEOUT_MS) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...options, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// --------------------------------------------------------------- key + model

async function readEnvFile() {
  if (!('OPENROUTER_API_KEY' in _envCache)) {
    try {
      const response = await fetchWithTimeout(chrome.runtime.getURL('.env'), {}, 5000);
      if (response.ok) {
        const parsed = parseDotEnv(await response.text());
        if (parsed.OPENROUTER_API_KEY) {
          _envCache.OPENROUTER_API_KEY = parsed.OPENROUTER_API_KEY.trim();
        }
      }
    } catch (_) {
      // .env is optional; the Settings tab stores the key instead.
    }
    _envCache.OPENROUTER_API_KEY = _envCache.OPENROUTER_API_KEY || '';
  }
  return _envCache.OPENROUTER_API_KEY;
}

/**
 * Resolve the API key: chrome.storage.local override (set from the Settings
 * tab) wins, .env in the extension root is the fallback.
 */
async function getApiKey(cached = true) {
  if (cached && _apiKeyMemo) return _apiKeyMemo;
  let stored = '';
  try {
    const result = await chrome.storage.local.get('openrouterApiKey');
    stored = String(result?.openrouterApiKey || '').trim();
  } catch (_) {}
  const apiKey = stored || (await readEnvFile());
  if (cached) _apiKeyMemo = apiKey;
  return apiKey;
}

function invalidateApiKey() {
  _apiKeyMemo = null;
}

async function getSettings() {
  let model = '';
  try {
    const { settings } = await chrome.storage.sync.get('settings');
    model = String(settings?.model || '');
  } catch (_) {}
  const cfg = PROVIDER_CONFIG.openrouter;
  const valid = cfg.models.some((m) => m.id === model);
  return { provider: 'openrouter', model: valid ? model : cfg.defaultModel };
}

async function readSystemPrompt() {
  if (_promptCache.text) return _promptCache.text;
  const response = await fetchWithTimeout(chrome.runtime.getURL('prompt.txt'), {}, 5000);
  if (!response.ok) {
    throw new Error(`Failed to read prompt.txt: ${response.status} ${response.statusText}`);
  }
  const prompt = (await response.text()).trim();
  if (!prompt) throw new Error('Missing system prompt. Please add it to prompt.txt.');
  _promptCache.text = prompt;
  return prompt;
}

// ---------------------------------------------------------------- OpenRouter

/** Map HTTP status + OpenRouter error body to a short, user-friendly message. */
function describeOpenRouterError(status, bodyText) {
  let detail = '';
  try {
    const parsed = JSON.parse(bodyText);
    detail = parsed?.error?.message || parsed?.error?.metadata?.raw || '';
    if (typeof detail !== 'string') detail = '';
  } catch (_) {
    detail = String(bodyText || '').slice(0, 160);
  }
  if (detail) detail = ` (${detail.slice(0, 200)})`;

  switch (status) {
    case 400:
      return `OpenRouter rejected the request${detail}`;
    case 401:
      return 'OpenRouter API key is missing or invalid. Set a valid key in Settings.';
    case 402:
      return 'OpenRouter account is out of credits. Add credits at openrouter.ai.';
    case 403:
      return `Request blocked by the model provider${detail}`;
    case 408:
      return 'The model took too long to respond. Try again.';
    case 429:
      return 'Rate limited by OpenRouter. Wait a moment and try again.';
    case 409:
    case 502:
    case 503:
    case 504:
      return `Model provider is temporarily unavailable${detail}. Try again.`;
    default:
      return `OpenRouter request failed (HTTP ${status})${detail}`;
  }
}

function extractAssistantText(data) {
  const choice = data?.choices?.[0];
  if (choice?.error?.message) {
    throw new Error(`Model provider error: ${String(choice.error.message).slice(0, 200)}`);
  }
  const content = choice?.message?.content;
  if (typeof content === 'string' && content.trim()) return content.trim();
  if (Array.isArray(content)) {
    const joined = content
      .map((part) => {
        if (typeof part === 'string') return part;
        if (part && typeof part === 'object' && typeof part.text === 'string') return part.text;
        return '';
      })
      .join('');
    if (joined.trim()) return joined.trim();
  }
  // Some reasoning models put the visible answer in reasoning_field style slots.
  const fallbackText = choice?.message?.reasoning;
  if (typeof fallbackText === 'string' && fallbackText.trim()) return fallbackText.trim();
  return null;
}

function isRetryableStatus(status) {
  // 408 timeout, 409 conflict, 429 rate limit, and provider 5xxblips.
  return status === 408 || status === 409 || status === 429 || status >= 500;
}

function isNetworkError(error) {
  return error instanceof TypeError || error?.name === 'AbortError';
}

/**
 * Single chat-completion entry point with timeout + retry + friendly errors.
 * @param {{model: string, messages: Array<{role: string, content: string}>,
 *          temperature?: number, top_p?: number, max_tokens?: number}} opts
 * @returns {Promise<string>} assistant text
 */
async function openRouterChatCompletion(opts) {
  const { model, messages, temperature = 0.7, top_p = 0.95, max_tokens = 3072 } = opts;
  const apiKey = await getApiKey();
  if (!apiKey) {
    throw new Error('No OpenRouter API key set. Open Settings and add your key.');
  }
  const manifest = chrome.runtime.getManifest();

  let lastError = null;
  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    if (attempt > 0) {
      await sleep(RETRY_BASE_DELAY_MS * 2 ** (attempt - 1) + Math.random() * 250);
    }
    try {
      const apiResponse = await fetchWithTimeout(OPENROUTER_CHAT_URL, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${apiKey}`,
          'Content-Type': 'application/json',
          'HTTP-Referer': chrome.runtime.getURL(''),
          'X-Title': manifest?.name || 'Chrome Extension',
        },
        body: JSON.stringify({ model, messages, temperature, top_p, max_tokens }),
      });

      const bodyText = await apiResponse.text();
      if (!apiResponse.ok) {
        lastError = new Error(describeOpenRouterError(apiResponse.status, bodyText));
        lastError.status = apiResponse.status;
        if (attempt < MAX_RETRIES && isRetryableStatus(apiResponse.status)) continue;
        throw lastError;
      }

      let data;
      try {
        data = JSON.parse(bodyText);
      } catch (_) {
        lastError = new Error('OpenRouter returned a non-JSON response.');
        if (attempt < MAX_RETRIES) continue;
        throw lastError;
      }
      const text = extractAssistantText(data);
      if (!text) {
        lastError = new Error('OpenRouter response was missing assistant text.');
        if (attempt < MAX_RETRIES) continue;
        throw lastError;
      }
      return text;
    } catch (error) {
      if (isNetworkError(error)) {
        lastError = error instanceof TypeError
          ? new Error('Could not reach OpenRouter. Check your connection.')
          : new Error('OpenRouter request timed out. Try again.');
        if (attempt < MAX_RETRIES) continue;
        throw lastError;
      }
      throw error;
    }
  }
  throw lastError || new Error('OpenRouter request failed.');
}

// ------------------------------------------------------------- key validation

/** Cheap key validation — GET /api/v1/key costs no tokens. */
async function testOpenRouterKey(candidateKey) {
  const apiKey = (candidateKey || (await getApiKey(false)) || '').trim();
  if (!apiKey) {
    return { ok: false, error: 'No API key set. Enter one in Settings.' };
  }
  try {
    const response = await fetchWithTimeout(OPENROUTER_KEY_URL, {
      headers: { Authorization: `Bearer ${apiKey}` },
    }, 10000);
    if (!response.ok) {
      if (response.status === 401 || response.status === 403) {
        return { ok: false, error: 'Key rejected by OpenRouter (invalid or revoked).' };
      }
      return { ok: false, error: `OpenRouter responded with HTTP ${response.status}.` };
    }
    const data = await response.json();
    const info = data?.data || {};
    const parts = [];
    if (info.label) parts.push(String(info.label));
    if (typeof info.usage === 'number') parts.push(`used $${info.usage.toFixed(2)}`);
    if (info.limit) parts.push(`limit $${Number(info.limit).toFixed(2)}`);
    return {
      ok: true,
      info: { label: info.label || '', usage: info.usage, limit: info.limit },
      summary: parts.join(' | '),
    };
  } catch (error) {
    return {
      ok: false,
      error: error instanceof TypeError
        ? 'Could not reach OpenRouter. Check your connection.'
        : 'Key check failed.',
    };
  }
}

// ------------------------------------------------------------ message router

/**
 * task → messages. 'review' and 'full' get prompt.txt as the system prompt
 * (it defines voice; persona/aspects tasks define their own format inline).
 */
async function buildMessages(task, userPrompt) {
  const messages = [];
  if (task === 'review' || task === 'full') {
    messages.push({ role: 'system', content: await readSystemPrompt() });
  }
  messages.push({ role: 'user', content: String(userPrompt || '') });
  return messages;
}

chrome.runtime.onMessage.addListener((request, _sender, sendResponse) => {
  if (request?.action === 'llmComplete') {
    (async () => {
      const messages = await buildMessages(request.task, request.userPrompt);
      const { model } = await getSettings();
      const text = await openRouterChatCompletion({ model, messages });
      sendResponse({ text });
    })().catch((error) => sendResponse({ error: error?.message || 'Unknown error' }));
    return true;
  }

  if (request?.action === 'testKey') {
    (async () => {
      const result = await testOpenRouterKey(request.apiKey);
      if (result.ok) {
        // Make sure a validated key is what gets used next (a saved override
        // may have just been entered without saving first).
        invalidateApiKey();
      }
      sendResponse(result);
    })().catch((error) => sendResponse({ ok: false, error: error?.message || 'Key check failed' }));
    return true;
  }

  return false;
});

// ------------------------------------------------- storage cleanup for tabs

// Data keyed by tab ID is session-scoped; delete it when the tab goes away.
chrome.tabs.onRemoved.addListener((tabId) => {
  chrome.storage.local.get(null)
    .then((all) => {
      const keys = Object.keys(all).filter((key) => key.endsWith(`_${tabId}`));
      if (keys.length) return chrome.storage.local.remove(keys);
      return undefined;
    })
    .catch((error) => console.error(`Error clearing storage for tab ${tabId}:`, error));
});
