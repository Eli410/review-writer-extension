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

async function generateTextViaOpenRouter({ prompt, systemPrompt = '', systemPromptFile = false }) {
  const response = await chrome.runtime.sendMessage({
    action: 'generateText',
    prompt,
    systemPrompt,
    systemPromptFile,
  });

  if (response?.error) {
    throw new Error(response.error);
  }
  if (!response?.text) {
    throw new Error('No text received from background script');
  }
  return response.text;
}

// Function to generate a persona
async function generatePersona(productInfo) {
  try {
    const personaPrompt =
      typeof buildPersonaPrompt === 'function'
        ? buildPersonaPrompt(productInfo)
        : (window.buildPersonaPrompt && window.buildPersonaPrompt(productInfo)) ||
          `Based on this product, create a realistic persona. Product: ${productInfo.title || 'N/A'}. Return JSON: { "age", "gender", "occupation", "description" }.`;
    const personaText = await generateTextViaOpenRouter({ prompt: personaPrompt });
    
    // Clean up the response text to handle potential markdown formatting
    // Strip <think>...</think> blocks (e.g. GLM 4.x chain-of-thought) so only final output remains
    const cleanedText = personaText
      .replace(/<think>[\s\S]*?<\/think>/gi, '')
      .replace(/```json\s*/gi, '')  // Remove ```json
      .replace(/```\s*/g, '')       // Remove closing ```
      .trim();                      // Remove extra whitespace
    
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
    const prompt =
      typeof buildAspectsPrompt === 'function'
        ? buildAspectsPrompt(productInfo)
        : (window.buildAspectsPrompt && window.buildAspectsPrompt(productInfo)) ||
          `Generate 5-8 key aspects for: ${productInfo.title || 'product'}. Return JSON array of strings only.`;
    const text = await generateTextViaOpenRouter({ prompt });

    // Clean up the response text to handle potential markdown formatting
    // Strip <think>...</think> blocks (e.g. GLM 4.x chain-of-thought) so only final output remains
    const cleanedText = text
      .replace(/<think>[\s\S]*?<\/think>/gi, '')
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
      // Enforce max 2 words per aspect
      const trimmed = aspects.map(a => a.trim().split(/\s+/).slice(0, 2).join(' ')).filter(Boolean);
      console.log('Successfully parsed aspects:', trimmed);
      return trimmed;
    } catch (parseError) {
      console.error('Failed to parse aspects JSON:', parseError);
      console.error('Raw text:', text);
      console.error('Cleaned text:', cleanedText);

      // Try to extract array from the text using regex
      const arrayMatch = cleanedText.match(/\[(.*)\]/s);
      if (arrayMatch && arrayMatch[0]) {
        try {
          const extractedArray = JSON.parse(arrayMatch[0]);
          if (Array.isArray(extractedArray) && extractedArray.every(aspect => typeof aspect === 'string')) {
            const trimmed = extractedArray.map(a => a.trim().split(/\s+/).slice(0, 2).join(' ')).filter(Boolean);
            console.log('Successfully extracted aspects using regex:', trimmed);
            return trimmed;
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

// Function to generate review using OpenRouter (Claude Haiku 4.5)
async function generateReview(productInfo, persona, extraDirections = '') {
  try {
    // Create the user prompt with product information and persona
    const userPrompt = `Product Information:
Title: ${productInfo.title || 'Not available'}
Description: ${productInfo.description || 'Not available'}
Category: ${productInfo.category || 'Not available'}
Features: ${productInfo.features && productInfo.features.length > 0 ? productInfo.features.join(', ') : 'Not available'}
Rating: ${productInfo.rating || 'Not available'}
Number of Reviews: ${productInfo.reviewsCount || 'Not available'}

Reviewer Persona:
Age: ${persona.age || 'Not available'}
Gender: ${persona.gender || 'Not available'}
Occupation: ${persona.occupation || 'Not available'}
Description: ${persona.description || 'Not available'}`;
    
    // Add extra directions to the user prompt if provided
    const noMedicalLine = 'Do not mention medical, health, or supplement effects or efficacy.';
    const finalUserPrompt = extraDirections
      ? `${userPrompt}\n\nAdditional Instructions:\n${extraDirections}\n${noMedicalLine}`
      : `${userPrompt}\n\n${noMedicalLine}`;
    const requestPrompt = `${finalUserPrompt}\n\nIMPORTANT: Return ONLY valid JSON on a single line with exactly this shape (no code fences, no extra keys, no extra text): {"title":"<concise headline>","review":"<full review body>"}`;

    console.log('Sending request to background script (OpenRouter)...');
    const reviewText = await generateTextViaOpenRouter({
      prompt: requestPrompt,
      // system prompt is loaded from prompt.txt by the background service worker
      systemPrompt: '',
      systemPromptFile: true
    });
    
    // Strip <think>...</think> blocks (e.g. GLM 4.x chain-of-thought) so only final output remains
    const cleanedText = String(reviewText || '')
      .replace(/<think>[\s\S]*?<\/think>/gi, '')
      .replace(/```json\s*/gi, '')
      .replace(/```\s*/g, '')
      .trim();

    let parsed = null;
    try {
      parsed = JSON.parse(cleanedText);
    } catch (parseError) {
      // Try to extract a JSON object from the response
      const objMatch = cleanedText.match(/\{[\s\S]*\}/);
      if (objMatch?.[0]) {
        parsed = JSON.parse(objMatch[0]);
      } else {
        throw new Error('Failed to parse review JSON. Please try regenerating.');
      }
    }

    const title = (parsed && typeof parsed.title === 'string' && parsed.title.trim())
      ? parsed.title.trim()
      : 'Product Review';
    const body = (parsed && typeof parsed.review === 'string')
      ? parsed.review.trim()
      : '';

    const formattedText = `Title: ${title}\n\nReview: ${body}`;
    return { title, review: body, formattedText };
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
      .then(result => sendResponse(result))
      .catch(error => sendResponse({ error: error.message }));
    return true; // Will respond asynchronously
  }
  return true; // Will respond asynchronously
}); 
