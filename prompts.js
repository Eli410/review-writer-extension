/**
 * Centralized prompt builders. Loaded by popup.html (before popup.js); the
 * popup orchestrates all generation now, so prompts live here and the content
 * scripts stay pure scrapers/fillers.
 */

/** Single-line description of the product, trimmed for token cost. */
function describeProduct(productInfo) {
  const info = productInfo || {};
  const features = Array.isArray(info.features) ? info.features.filter(Boolean).join('; ') : '';
  return [
    `Title: ${info.title || 'Not available'}`,
    `Description: ${info.description || 'Not available'}`,
    `Category: ${info.category || 'Not available'}`,
    `Features: ${features || 'Not available'}`,
    `Price: ${info.price || 'Not available'}`,
    `Rating: ${info.rating || 'Not available'}`,
    `Number of Reviews: ${info.reviewsCount || 'Not available'}`,
  ].join('\n');
}

function buildPersonaPrompt(productInfo) {
  return `Based on this product, create a realistic persona of someone who would likely buy and review it.

Product Information:
${describeProduct(productInfo)}

Return a JSON object on a single line, exactly:
{"age": <number>, "gender": "<string>", "occupation": "<string>", "description": "<string>"}

Rules for "description": one short sentence or a few concrete traits only (e.g. "busy parent, casual runner"), max 80 characters. No narrative or backstory. No code fences or extra text.`;
}

function buildAspectsPrompt(productInfo) {
  return `Generate 4-5 key aspects a typical consumer would use when evaluating this product. Focus only on product-related attributes (quality, performance, taste, size, ease of use, durability). Exclude marketing terms, certifications, branding, and anything value/price/cost related.

Product Information:
${describeProduct(productInfo)}

Return a JSON array of 4-5 strings on a single line, each aspect 1-2 words max. Example: ["Taste","Quality","Ease of use","Durability"]. No code fences or extra text.`;
}

function buildReviewPrompt(productInfo, persona, aspects, extraDirections = '') {
  const parts = [];
  if (aspects && aspects.length > 0) {
    parts.push(`Additional Instructions:\nPlease focus on these key aspects in your review: ${aspects.join(', ')}.`);
  }
  parts.push('Do not mention medical, health, or supplement effects or efficacy.');

  return `Product Information:
${describeProduct(productInfo)}

Reviewer Persona:
Age: ${persona?.age || 'Not available'}
Gender: ${persona?.gender || 'Not available'}
Occupation: ${persona?.occupation || 'Not available'}
Description: ${persona?.description || 'Not available'}

${parts.join('\n')}

IMPORTANT: Return ONLY valid JSON on a single line with exactly this shape (no code fences, no extra keys, no extra text):
{"title":"<concise headline>","review":"<full review body>"}`;
}

/**
 * One-call generation when a product is fresh: persona + aspects + review in a
 * single completion. Saves two round trips and works out cheaper than three
 * separate calls.
 */
function buildFullPrompt(productInfo) {
  return `Product Information:
${describeProduct(productInfo)}

Do all three tasks below in one response. Follow the same review voice you are given for reviews: casual, direct, a bit messy, human. Do not mention medical, health, or supplement effects or efficacy.

Return ONLY valid JSON on a single line with exactly this shape (no code fences, no extra text):
{"persona":{"age":<number>,"gender":"<string>","occupation":"<string>","description":"<short traits, max 80 chars>"},"aspects":["<1-2 words>","<1-2 words>","<1-2 words>","<1-2 words>"],"review":{"title":"<concise headline>","review":"<full review body>"}}

Rules:
- persona: a realistic buyer/reviewer of this product (as above).
- aspects: 4-5 consumer evaluation aspects, 1-2 words each, no value/price/cost items.
- review: follows the same instructions as a standalone review request.`;
}

window.buildPersonaPrompt = buildPersonaPrompt;
window.buildAspectsPrompt = buildAspectsPrompt;
window.buildReviewPrompt = buildReviewPrompt;
window.buildFullPrompt = buildFullPrompt;
