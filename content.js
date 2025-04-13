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

// Function to generate a persona using Gemini API
async function generatePersona(productInfo) {
  try {
    const apiKey = await readFile('key.txt');
    
    if (!apiKey) {
      throw new Error('Missing API key. Please check key.txt file.');
    }

    const personaPrompt = `Based on this product, create a realistic persona of someone who would likely buy and review it. Include their age, gender, occupation, and a brief description of their interests/lifestyle that would make them likely to buy this product.

Product Information:
Title: ${productInfo.title}
Description: ${productInfo.description}

Format the response as a JSON object with the following structure:
{
  "age": number,
  "gender": string,
  "occupation": string,
  "description": string
}

IMPORTANT: 
- Return ONLY the JSON object without any markdown formatting, code blocks, or additional text.
- Keep the description short, just 2-3 sentences about their interests and lifestyle.`;

    const response = await fetch('https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=' + apiKey, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        contents: [{
          parts: [{
            text: personaPrompt
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

    if (!response.ok) {
      const errorText = await response.text();
      console.error('API Error Response:', errorText);
      throw new Error(`API request failed with status ${response.status}: ${errorText}`);
    }

    const data = await response.json();
    console.log('Persona API Response:', data);
    
    if (!data.candidates || data.candidates.length === 0) {
      throw new Error('No persona generated. API response format unexpected.');
    }
    
    const personaText = data.candidates[0].content.parts[0].text;
    
    // Clean up the response text to handle potential markdown formatting
    const cleanedText = personaText
      .replace(/```json\s*/g, '')  // Remove ```json
      .replace(/```\s*/g, '')      // Remove closing ```
      .trim();                     // Remove extra whitespace
    
    try {
      return JSON.parse(cleanedText);
    } catch (parseError) {
      console.error('Failed to parse persona JSON:', parseError);
      console.error('Raw text:', personaText);
      console.error('Cleaned text:', cleanedText);
      throw new Error('Failed to parse persona JSON. Please try regenerating.');
    }
  } catch (error) {
    console.error('Error generating persona:', error);
    throw new Error(`Failed to generate persona: ${error.message}`);
  }
}

// Function to generate review using Gemini API
async function generateReview(productInfo, persona, extraDirections = '') {
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

    // Create the user prompt with product information and persona
    const userPrompt = `Product Information:
Title: ${productInfo.title}
Description: ${productInfo.description}

Reviewer Persona:
Age: ${persona.age}
Gender: ${persona.gender}
Occupation: ${persona.occupation}
Description: ${persona.description}`;
    
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
  } else if (request.action === 'generatePersona') {
    // Use provided product info or extract it from the page
    const productInfo = request.productInfo || extractProductInfo();
    
    generatePersona(productInfo)
      .then(persona => sendResponse({ persona }))
      .catch(error => sendResponse({ error: error.message }));
    return true; // Will respond asynchronously
  } else if (request.action === 'generateReview') {
    // Use provided product info or extract it from the page
    const productInfo = request.productInfo || extractProductInfo();
    const persona = request.persona;
    const extraDirections = request.extraDirections || '';
    
    generateReview(productInfo, persona, extraDirections)
      .then(review => sendResponse({ review }))
      .catch(error => sendResponse({ error: error.message }));
    return true; // Will respond asynchronously
  }
  return true; // Will respond asynchronously
}); 