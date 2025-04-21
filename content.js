// Function to extract product information from the Amazon page
function extractProductInfo() {
  const productInfo = {
    title: document.querySelector('#productTitle')?.textContent.trim(),
    description: document.querySelector('#productDescription')?.textContent.trim(),
    features: [],
    category: '',
    price: '',
    rating: '',
    reviewsCount: ''
  };
  
  // Extract features
  const featureBullets = document.querySelector('#feature-bullets');
  if (featureBullets) {
    const bulletPoints = featureBullets.querySelectorAll('li');
    bulletPoints.forEach(bullet => {
      productInfo.features.push(bullet.textContent.trim());
    });
  }
  
  // Extract category
  const categoryElement = document.querySelector('#wayfinding-breadcrumbs_container');
  if (categoryElement) {
    const categoryLinks = categoryElement.querySelectorAll('a');
    if (categoryLinks.length > 0) {
      productInfo.category = categoryLinks[categoryLinks.length - 1].textContent.trim();
    }
  }
  
  // Extract price
  const priceElement = document.querySelector('.a-price .a-offscreen');
  if (priceElement) {
    productInfo.price = priceElement.textContent.trim();
  }
  
  // Extract rating
  const ratingElement = document.querySelector('.a-icon-star-small .a-icon-alt');
  if (ratingElement) {
    productInfo.rating = ratingElement.textContent.trim();
  }
  
  // Extract reviews count
  const reviewsCountElement = document.getElementById('acrCustomerReviewText');
  if (reviewsCountElement) {
    productInfo.reviewsCount = reviewsCountElement.textContent.trim();
  }
  
  return productInfo;
}

// Function to get just the product title
function getProductTitle() {
  return document.querySelector('#productTitle')?.textContent.trim() || null;
}

// Function to extract ASIN from URL
function extractAsin() {
  // Format: amazon.com/dp/B07QT8RTV2 or amazon.com/dp/B07QT8RTV2/
  const dpMatch = window.location.pathname.match(/\/dp\/([A-Z0-9]{10})/);
  if (dpMatch && dpMatch[1]) {
    return dpMatch[1];
  }
  
  // Format: amazon.com/review/review-your-purchases/?asin=B07QT8RTV2
  const asinMatch = window.location.search.match(/[?&]asin=([A-Z0-9]{10})/);
  if (asinMatch && asinMatch[1]) {
    return asinMatch[1];
  }
  
  return null;
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
Title: ${productInfo.title || 'Not available'}
Description: ${productInfo.description || 'Not available'}
Category: ${productInfo.category || 'Not available'}
Features: ${productInfo.features && productInfo.features.length > 0 ? productInfo.features.join(', ') : 'Not available'}
Price: ${productInfo.price || 'Not available'}
Rating: ${productInfo.rating || 'Not available'}
Number of Reviews: ${productInfo.reviewsCount || 'Not available'}

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

// Function to generate key aspects
async function generateAspects(productInfo) {
  try {
    console.log('Generating aspects for product:', productInfo);
    
    // Create a prompt for the aspects generation
    const prompt = `Generate 5-8 key aspects that buyers would look for when purchasing and reviewing this product:
    
    Product Title: ${productInfo.title || 'Not available'}
    Product Category: ${productInfo.category || 'Not available'}
    Product Description: ${productInfo.description || 'Not available'}
    Product Features: ${productInfo.features && productInfo.features.length > 0 ? productInfo.features.join(', ') : 'Not available'}
    Product Price: ${productInfo.price || 'Not available'}
    Product Rating: ${productInfo.rating || 'Not available'}
    Number of Reviews: ${productInfo.reviewsCount || 'Not available'}
    
    The aspects should be:
    1. Relevant to the product category and type
    2. Important to potential buyers
    3. Specific enough to guide a detailed review
    4. Written as short phrases (1-3 words each)
    
    Format the response as a JSON array of strings, for example:
    ["Durability", "Ease of Use", "Value for Money"]
    
    IMPORTANT: Return ONLY the JSON array without any markdown formatting, code blocks, or additional text.`;
    
    console.log('Sending prompt to background script:', prompt);
    
    // Send the prompt to the background script
    const response = await chrome.runtime.sendMessage({
      action: 'generateText',
      prompt: prompt
    });
    
    console.log('Received response from background script:', response);
    
    if (response.error) {
      throw new Error(response.error);
    }
    
    if (!response.text) {
      throw new Error('No text received from background script');
    }
    
    // Clean up the response text to handle potential markdown formatting
    const cleanedText = response.text
      .replace(/```json\s*/g, '')  // Remove ```json
      .replace(/```\s*/g, '')      // Remove closing ```
      .trim();                     // Remove extra whitespace
    
    console.log('Cleaned text for JSON parsing:', cleanedText);
    
    try {
      // Parse the response as JSON
      const aspects = JSON.parse(cleanedText);
      
      // Validate that it's an array
      if (!Array.isArray(aspects)) {
        throw new Error('Response is not an array');
      }
      
      // Validate that all elements are strings
      if (!aspects.every(aspect => typeof aspect === 'string')) {
        throw new Error('Response contains non-string elements');
      }
      
      console.log('Successfully parsed aspects:', aspects);
      return aspects;
    } catch (parseError) {
      console.error('Failed to parse aspects JSON:', parseError);
      console.error('Raw text:', response.text);
      console.error('Cleaned text:', cleanedText);
      
      // Try to extract array from the text using regex
      const arrayMatch = cleanedText.match(/\[(.*)\]/s);
      if (arrayMatch && arrayMatch[0]) {
        try {
          const extractedArray = JSON.parse(arrayMatch[0]);
          if (Array.isArray(extractedArray) && extractedArray.every(aspect => typeof aspect === 'string')) {
            console.log('Successfully extracted aspects using regex:', extractedArray);
            return extractedArray;
          }
        } catch (extractError) {
          console.error('Failed to parse extracted array:', extractError);
        }
      }
      
      throw new Error('Failed to parse aspects JSON. Please try regenerating.');
    }
  } catch (error) {
    console.error('Error generating aspects:', error);
    throw error;
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
Title: ${productInfo.title || 'Not available'}
Description: ${productInfo.description || 'Not available'}
Category: ${productInfo.category || 'Not available'}
Features: ${productInfo.features && productInfo.features.length > 0 ? productInfo.features.join(', ') : 'Not available'}
Price: ${productInfo.price || 'Not available'}
Rating: ${productInfo.rating || 'Not available'}
Number of Reviews: ${productInfo.reviewsCount || 'Not available'}

Reviewer Persona:
Age: ${persona.age || 'Not available'}
Gender: ${persona.gender || 'Not available'}
Occupation: ${persona.occupation || 'Not available'}
Description: ${persona.description || 'Not available'}`;
    
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
    
    const reviewText = data.candidates[0].content.parts[0].text;
    
    // Ensure the review text has the correct format
    // If it doesn't have "Review:" and "Title:" sections, add them
    if (!reviewText.includes('Review:') || !reviewText.includes('Title:')) {
      console.log('Review text does not have the expected format, adding format markers');
      
      // Split the text into paragraphs
      const paragraphs = reviewText.split('\n\n').filter(p => p.trim());
      
      if (paragraphs.length >= 2) {
        // Assume the first paragraph is the review and the second is the title
        const formattedText = `Review: ${paragraphs[0]}\n\nTitle: ${paragraphs[1]}`;
        return formattedText;
      } else if (paragraphs.length === 1) {
        // If there's only one paragraph, assume it's the review and generate a generic title
        const formattedText = `Review: ${paragraphs[0]}\n\nTitle: Product Review`;
        return formattedText;
      } else {
        // If there are no paragraphs, return the original text with format markers
        return `Review: ${reviewText}\n\nTitle: Product Review`;
      }
    }
    
    return reviewText;
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
  } else if (request.action === 'getAsin') {
    const asin = extractAsin();
    sendResponse({ asin });
  } else if (request.action === 'generatePersona') {
    // Use provided product info or extract it from the page
    const productInfo = request.productInfo || extractProductInfo();
    
    generatePersona(productInfo)
      .then(persona => sendResponse({ persona }))
      .catch(error => sendResponse({ error: error.message }));
    return true; // Will respond asynchronously
  } else if (request.action === 'generateAspects') {
    generateAspects(request.productInfo)
      .then(aspects => sendResponse({ aspects }))
      .catch(error => sendResponse({ error: error.message }));
    return true;
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