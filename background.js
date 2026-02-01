// Listen for tab removal events
chrome.tabs.onRemoved.addListener(async (tabId) => {
  // This event is triggered when a tab is closed
  console.log(`Tab ${tabId} was closed`);

  // Clean up stored data for this tab
  try {
    // Get all keys from storage
    const allKeys = await chrome.storage.local.get(null);

    // Find keys that end with this tab ID
    const keysToRemove = Object.keys(allKeys).filter((key) => key.endsWith(`_${tabId}`));

    if (keysToRemove.length > 0) {
      await chrome.storage.local.remove(keysToRemove);
      console.log(`Cleared storage for tab ${tabId}: ${keysToRemove.join(', ')}`);
    } else {
      console.log(`No storage keys found for tab ${tabId}`);
    }
  } catch (error) {
    console.error(`Error clearing storage for tab ${tabId}:`, error);
  }
});


function parseDotEnv(envText) {
  const result = {};
  const lines = String(envText || '').split(/\r?\n/);
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eq = trimmed.indexOf('=');
    if (eq === -1) continue;
    const key = trimmed.slice(0, eq).trim();
    let value = trimmed.slice(eq + 1).trim();
    // Strip surrounding quotes
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    result[key] = value;
  }
  return result;
}

async function readOpenRouterApiKey() {
  const response = await fetch(chrome.runtime.getURL('.env'));
  if (!response.ok) {
    throw new Error(`Failed to read .env: ${response.status} ${response.statusText}`);
  }
  const envText = await response.text();
  const env = parseDotEnv(envText);
  const apiKey = (env.OPENROUTER_API_KEY || '').trim();
  if (!apiKey) {
    throw new Error('Missing OPENROUTER_API_KEY in .env');
  }
  return apiKey;
}

async function readSystemPrompt() {
  const response = await fetch(chrome.runtime.getURL('prompt.txt'));
  if (!response.ok) {
    throw new Error(`Failed to read prompt.txt: ${response.status} ${response.statusText}`);
  }
  const prompt = (await response.text()).trim();
  if (!prompt) {
    throw new Error('Missing system prompt. Please add it to prompt.txt.');
  }
  return prompt;
}

function extractAssistantTextFromOpenRouterResponse(data) {
  const choice = data?.choices?.[0];
  const content = choice?.message?.content;

  // OpenAI-style: string content
  if (typeof content === 'string') return content;

  // Some models can return an array of content parts
  if (Array.isArray(content)) {
    return content
      .map((part) => {
        if (typeof part === 'string') return part;
        if (part && typeof part === 'object' && typeof part.text === 'string') return part.text;
        return '';
      })
      .join('')
      .trim();
  }

  return null;
}

async function openRouterChatCompletion({ model, messages, temperature = 0.7, top_p = 0.95, max_tokens = 1024 }) {
  const apiKey = await readOpenRouterApiKey();
  const manifest = chrome.runtime.getManifest();

  const apiResponse = await fetch('https://openrouter.ai/api/v1/chat/completions', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
      // Optional headers recommended by OpenRouter
      'HTTP-Referer': chrome.runtime.getURL(''),
      'X-Title': manifest?.name || 'Chrome Extension',
    },
    body: JSON.stringify({
      model,
      messages,
      temperature,
      top_p,
      max_tokens,
    }),
  });

  if (!apiResponse.ok) {
    const errorText = await apiResponse.text();
    throw new Error(`OpenRouter request failed (${apiResponse.status}): ${errorText}`);
  }

  const data = await apiResponse.json();
  const text = extractAssistantTextFromOpenRouterResponse(data);
  if (!text) {
    throw new Error('OpenRouter response missing assistant text.');
  }
  return text;
}

// Listen for messages from content scripts
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.action === 'generateText') {
    const prompt = request.prompt || '';
    const inlineSystemPrompt = request.systemPrompt || '';
    const systemPromptFile = Boolean(request.systemPromptFile);

    (async () => {
      const messages = [];
      const systemPrompt = systemPromptFile ? await readSystemPrompt() : inlineSystemPrompt;
      if (systemPrompt) messages.push({ role: 'system', content: systemPrompt });
      // Match OpenRouter's multimodal-capable "content parts" format (text-only here).
      messages.push({ role: 'user', content: [{ type: 'text', text: prompt }] });

      const text = await openRouterChatCompletion({
        model: 'google/gemini-2.5-flash-lite',
        messages,
      });
      sendResponse({ text });
    })().catch((error) => sendResponse({ error: error.message }));

    return true; // async
  }
});