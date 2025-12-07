// Listen for tab removal events
chrome.tabs.onRemoved.addListener(async (tabId) => {
  // This event is triggered when a tab is closed
  console.log(`Tab ${tabId} was closed`);
  
  // Clean up stored data for this tab
  try {
    // Get all keys from storage
    const allKeys = await chrome.storage.local.get(null);
    
    // Find keys that end with this tab ID
    const keysToRemove = Object.keys(allKeys).filter(key => key.endsWith(`_${tabId}`));
    
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

// Listen for messages from content scripts
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.action === 'generateText') {
    // Handle text generation requests
    generateText(request.prompt)
      .then(text => sendResponse({ text }))
      .catch(error => sendResponse({ error: error.message }));
    return true; // Will respond asynchronously
  }
});

// Safely pull the first text part from a Gemini response
function extractTextFromGeminiResponse(data) {
  const candidates = data?.candidates;
  if (!Array.isArray(candidates) || candidates.length === 0) {
    throw new Error('No candidates returned from model');
  }

  const candidate = candidates[0];
  const content = candidate?.content;

  // Standard shape: content.parts
  const parts = content?.parts;
  if (Array.isArray(parts)) {
    const textPart = parts.find(part => typeof part?.text === 'string');
    if (textPart?.text) return textPart.text;
  }

  // Some responses can nest parts differently (e.g., content as array)
  if (Array.isArray(content)) {
    const nestedPartWithText = content
      .flatMap(part => part?.parts && Array.isArray(part.parts) ? part.parts : [part])
      .find(part => typeof part?.text === 'string');
    if (nestedPartWithText?.text) return nestedPartWithText.text;
  }

  if (typeof candidate?.output === 'string') {
    return candidate.output;
  }

  throw new Error('Model response missing text content');
}

// Function to generate text using Gemini API
async function generateText(prompt) {
  try {
    // Read API key
    const response = await fetch(chrome.runtime.getURL('key.txt'));
    if (!response.ok) {
      throw new Error(`Failed to read key.txt: ${response.status} ${response.statusText}`);
    }
    const apiKey = await response.text();
    
    if (!apiKey) {
      throw new Error('Missing API key. Please check key.txt file.');
    }
    
    console.log('Sending request to Gemini API...');
    
    const apiResponse = await fetch('https://generativelanguage.googleapis.com/v1beta/models/gemma-3-27b-it:generateContent?key=' + apiKey, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        contents: [{
          parts: [{
            text: prompt
          }]
        }],
        generationConfig: {
          temperature: 0.7,
          topK: 40,
          topP: 0.95,
          maxOutputTokens: 1024,
        },
        safetySettings: [
          {
            category: "HARM_CATEGORY_HARASSMENT",
            threshold: "BLOCK_MEDIUM_AND_ABOVE"
          },
          {
            category: "HARM_CATEGORY_HATE_SPEECH",
            threshold: "BLOCK_MEDIUM_AND_ABOVE"
          },
          {
            category: "HARM_CATEGORY_SEXUALLY_EXPLICIT",
            threshold: "BLOCK_MEDIUM_AND_ABOVE"
          },
          {
            category: "HARM_CATEGORY_DANGEROUS_CONTENT",
            threshold: "BLOCK_MEDIUM_AND_ABOVE"
          }
        ]
      }),
    });

    if (!apiResponse.ok) {
      const errorText = await apiResponse.text();
      console.error('API Error Response:', errorText);
      throw new Error(`API request failed with status ${apiResponse.status}: ${errorText}`);
    }

    const data = await apiResponse.json();
    console.log('API Response:', data);
    
    if (!data.candidates || data.candidates.length === 0) {
      throw new Error('No text generated. API response format unexpected.');
    }
    
    return extractTextFromGeminiResponse(data);
  } catch (error) {
    console.error('Error generating text:', error);
    throw new Error(`Failed to generate text: ${error.message}`);
  }
}
