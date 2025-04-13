// Function to extract product information from the Amazon page
function extractProductInfo() {
  const productInfo = {
    title: document.querySelector('#productTitle')?.textContent.trim(),
    description: document.querySelector('#productDescription')?.textContent.trim()
  };
  return productInfo;
}

// Function to get just the product title
function getProductTitle() {
  return document.querySelector('#productTitle')?.textContent.trim() || null;
}

// Function to read file content
async function readFile(filePath) {
  try {
    const response = await fetch(chrome.runtime.getURL(filePath));
    if (!response.ok) {
      throw new Error(`Failed to read ${filePath}: ${response.status} ${response.statusText}`);
    }
    return await response.text();
  } catch (error) {
    console.error(`Error reading ${filePath}:`, error);
    throw new Error(`Failed to read ${filePath}: ${error.message}`);
  }
}

// Function to generate review using Gemini API
async function generateReview(productInfo, extraDirections = '') {
  try {
    // Read API key and system prompt
    const [apiKey, systemPrompt] = await Promise.all([
      readFile('key.txt'),
      readFile('prompt.txt')
    ]);

    if (!apiKey) {
      throw new Error('Missing API key. Please check key.txt file.');
    }
    
    if (!systemPrompt) {
      throw new Error('Missing system prompt. Please check prompt.txt file.');
    }

    // Create the user prompt with product information (only title and description)
    const userPrompt = `Product Information:\nTitle: ${productInfo.title}\nDescription: ${productInfo.description}`;
    
    // Add extra directions to the user prompt if provided
    const finalUserPrompt = extraDirections 
      ? `${userPrompt}\n\nAdditional Instructions:\n${extraDirections}`
      : userPrompt;

    console.log('Sending request to Gemini API...');
    
    const response = await fetch('https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=' + apiKey, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        contents: [{
          parts: [{
            text: finalUserPrompt
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
        ],
        systemInstruction: {
          parts: [{
            text: systemPrompt
          }]
        }
      }),
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error('API Error Response:', errorText);
      throw new Error(`API request failed with status ${response.status}: ${errorText}`);
    }

    const data = await response.json();
    console.log('API Response:', data);
    
    if (!data.candidates || data.candidates.length === 0) {
      throw new Error('No review generated. API response format unexpected.');
    }
    
    return data.candidates[0].content.parts[0].text;
  } catch (error) {
    console.error('Error generating review:', error);
    throw new Error(`Failed to generate review: ${error.message}`);
  }
}

// Listen for messages from the popup
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.action === 'ping') {
    sendResponse({ status: 'ok' });
  } else if (request.action === 'getProductTitle') {
    const title = getProductTitle();
    sendResponse({ title });
  } else if (request.action === 'getProductInfo') {
    const productInfo = extractProductInfo();
    sendResponse({ productInfo });
  } else if (request.action === 'generateReview') {
    // Use provided product info or extract it from the page
    const productInfo = request.productInfo || extractProductInfo();
    const extraDirections = request.extraDirections || '';
    
    generateReview(productInfo, extraDirections)
      .then(review => sendResponse({ review }))
      .catch(error => sendResponse({ error: error.message }));
    return true; // Will respond asynchronously
  }
  return true; // Will respond asynchronously
}); 