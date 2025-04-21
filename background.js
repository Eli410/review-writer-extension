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
    
    const apiResponse = await fetch('https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=' + apiKey, {
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
    
    return data.candidates[0].content.parts[0].text;
  } catch (error) {
    console.error('Error generating text:', error);
    throw new Error(`Failed to generate text: ${error.message}`);
  }
} 