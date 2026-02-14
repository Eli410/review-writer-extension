/**
 * Centralized prompt builders for persona and aspects.
 * Used by content.js; loaded before content.js in the content script list.
 */
function buildPersonaPrompt(productInfo) {
  return `Based on this product, create a realistic persona of someone who would likely buy and review it. Include their age, gender, occupation, and a very brief description: one short phrase or a few concrete traits only (e.g. busy parent, casual runner, home cook). Do not write a narrative or story; list only brief, concrete traits.

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
- Return ONLY the JSON object (no code fences, no extra text, single line JSON).
- Ensure the JSON is valid (no trailing commas, close all quotes/braces).
- Description: one short sentence or a few traits only, max 80 characters. No narrative or backstory.`;
}

function buildAspectsPrompt(productInfo) {
  return `Generate 4-5 key aspects that a typical consumer would actually use when deciding or reviewing this product. Focus only on product-related attributes and how people evaluate the item.

Do not use marketing terms, certifications, or branding labels. Every aspect must describe the product itself or how a buyer would judge it (e.g. quality, performance, taste, size, ease of use, durability). Do not include value, price, cost, or any money-related aspects.

CRITICAL: Each aspect must be at most 2 words. Single words or two-word phrases only, in a JSON array.

Product Title: ${productInfo.title || 'Not available'}
Product Category: ${productInfo.category || 'Not available'}
Product Description: ${productInfo.description || 'Not available'}
Product Features: ${productInfo.features && productInfo.features.length > 0 ? productInfo.features.join(', ') : 'Not available'}
Product Rating: ${productInfo.rating || 'Not available'}
Number of Reviews: ${productInfo.reviewsCount || 'Not available'}

Return a JSON array of 4-5 strings. Each string = 1 or 2 words max. Consumer-focused examples only (never value/price/cost):
["Taste", "Quality", "Ease of use", "Durability"]

IMPORTANT: Return ONLY the JSON array, no markdown or extra text. Every aspect must be 2 words max and related to the product and how a consumer would consider it.`;
}

window.buildPersonaPrompt = buildPersonaPrompt;
window.buildAspectsPrompt = buildAspectsPrompt;
