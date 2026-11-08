/**
 * Shared helpers for the popup, content scripts, and the review-fill page.
 * All functions are plain globals (classic scripts) and also exposed on window.
 *
 * Storage layout: data keyed by ASIN persists per product; data keyed by tab ID
 * is session-scoped and cleaned up by the service worker when the tab closes.
 */

/**
 * @param {string} key - 'review' | 'aspects' | 'persona' | 'productInfo'
 * @param {string|number} asinOrTabId - ASIN (string) when available, else tab ID
 * @returns {string}
 */
function getStorageKey(key, asinOrTabId) {
  return `${key}_${asinOrTabId}`;
}

/** Extract a 10-character ASIN from /dp/ASIN or ?asin=ASIN style Amazon URLs. */
function extractAsin(href) {
  const url = href || (typeof window !== 'undefined' ? window.location.href : '');
  if (!url) return null;
  const dpMatch = url.match(/\/dp\/([A-Z0-9]{10})/);
  if (dpMatch && dpMatch[1]) return dpMatch[1];
  const asinMatch = url.match(/[?&]asin=([A-Z0-9]{10})/);
  if (asinMatch && asinMatch[1]) return asinMatch[1];
  return null;
}

/** Strip reasoning blocks and code fences some models wrap output in. */
function stripModelDecorations(text) {
  return String(text || '')
    .replace(/<(?:met|think|reasoning)>[\s\S]*?<\/(?:met|think|reasoning)>/gi, '')
    .replace(/```json\s*/gi, '')
    .replace(/```\s*/g, '')
    .trim();
}

/**
 * Extract the first balanced JSON value ({...} or [...]) from arbitrary text.
 * Handles nested braces and string literals; returns null if none or unbalanced.
 */
function extractJsonBlock(text) {
  const input = String(text || '');
  const open = input.search(/[{\[]/);
  if (open === -1) return null;
  const openChar = input[open];
  const closeChar = openChar === '{' ? '}' : ']';
  let depth = 0;
  let inString = false;
  let escaped = false;
  for (let i = open; i < input.length; i++) {
    const ch = input[i];
    if (inString) {
      if (escaped) escaped = false;
      else if (ch === '\\') escaped = true;
      else if (ch === '"') inString = false;
      continue;
    }
    if (ch === '"') {
      inString = true;
      continue;
    }
    if (ch === openChar) depth++;
    else if (ch === closeChar) {
      depth--;
      if (depth === 0) return input.slice(open, i + 1);
    }
  }
  return null;
}

/**
 * Parse LLM output as JSON: try direct parse after cleanup, then fall back to
 * extracting the first balanced JSON block from surrounding prose.
 * @returns {unknown} parsed JSON, or null if nothing valid is found.
 */
function parseJsonFromLLM(text) {
  const cleaned = stripModelDecorations(text);
  try {
    return JSON.parse(cleaned);
  } catch (_) {}
  const block = extractJsonBlock(cleaned);
  if (block) {
    try {
      return JSON.parse(block);
    } catch (_) {}
  }
  return null;
}

/** Replace word-internal hyphens, em dashes, and spaced hyphens with commas/spaces. */
function normalizeDashes(str) {
  if (!str || typeof str !== 'string') return str;
  return str
    .replace(/\b([a-zA-Z]+)-([a-zA-Z]+)\b/g, '$1 $2')
    .replace(/[*]+/g, '')
    .replace(/—/g, ', ')
    .replace(/\s*-\s*/g, ', ')
    .replace(/,\s*,/g, ',');
}

/**
 * Parse review text into {title, review}. Accepts, in order:
 *  1. A JSON object like {"title": "...", "review": "..."}
 *  2. "Title: ...\n\nReview: ..." format
 *  3. Loosely split paragraphs (first paragraph = review, second = title)
 */
function parseReviewText(raw, fallbackTitle = 'Product Review') {
  const text = String(raw || '');
  if (!text.trim()) {
    return { title: '', review: '' };
  }

  let title = fallbackTitle;
  let review = text;

  const parsed = parseJsonFromLLM(text);
  if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
    if (typeof parsed.title === 'string' && parsed.title.trim()) title = parsed.title.trim();
    if (typeof parsed.review === 'string') review = parsed.review.trim();
    return { title: normalizeDashes(title), review: normalizeDashes(review) };
  }

  const titleMatch = text.match(/Title:\s*([^\n]+)/i);
  const reviewMatch = text.match(/Review:\s*([\s\S]+?)(?=\n\nTitle:|$)/i);
  if (titleMatch && reviewMatch) {
    title = titleMatch[1].trim();
    review = reviewMatch[1].trim();
  } else {
    const paragraphs = text.split('\n\n').filter((p) => p && p.trim());
    if (paragraphs.length >= 2) {
      review = paragraphs[0].trim();
      title = paragraphs[1].trim();
    } else if (paragraphs.length === 1) {
      review = paragraphs[0].trim();
    }
  }

  review = String(review || '').replace(/^Review:\s*/i, '').trim();
  return { title: normalizeDashes(title), review: normalizeDashes(review) };
}

if (typeof window !== 'undefined') {
  window.getStorageKey = getStorageKey;
  window.extractAsin = extractAsin;
  window.stripModelDecorations = stripModelDecorations;
  window.extractJsonBlock = extractJsonBlock;
  window.parseJsonFromLLM = parseJsonFromLLM;
  window.normalizeDashes = normalizeDashes;
  window.parseReviewText = parseReviewText;
}
