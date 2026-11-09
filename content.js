/**
 * Content script for all Amazon product pages. Pure scraper: the popup drives
 * everything (LLM calls go popup → background service worker, never through
 * this script). Keep it small so injection stays fast.
 *
 * Wrapped in a versioned boot guard: the popup re-injects this file to heal
 * pages whose resident copy predates an extension reload, and duplicate
 * evaluations must not register duplicate message listeners.
 */
(function bootContentScript() {
  if (typeof window !== 'undefined' && Number(window.__arwContentBoot || 0) >= 2) return;
  if (typeof window !== 'undefined') window.__arwContentBoot = 2;

function extractProductInfo() {
  const info = {
    title: '',
    description: '',
    features: [],
    category: '',
    price: '',
    rating: '',
    reviewsCount: '',
  };

  info.title = document.querySelector('#productTitle')?.textContent?.trim() || '';
  info.description = document.querySelector('#productDescription')?.textContent?.trim() || '';

  const featureBullets = document.querySelectorAll('#feature-bullets li span.a-list-item');
  const seen = new Set();
  for (const node of featureBullets) {
    const text = (node.textContent || '').trim();
    if (!text || /^see (more|less)$/i.test(text) || seen.has(text)) continue;
    seen.add(text);
    info.features.push(text);
  }

  const crumbs = document.querySelectorAll('#wayfinding-breadcrumbs_container a');
  if (crumbs.length > 0) info.category = crumbs[crumbs.length - 1].textContent.trim();

  info.price = document.querySelector('.a-price .a-offscreen')?.textContent?.trim() || '';
  info.rating = document.querySelector('.a-icon-star-small .a-icon-alt')?.textContent?.trim() || '';
  info.reviewsCount = document.getElementById('acrCustomerReviewText')?.textContent?.trim() || '';

  return info;
}

// ------------------------------------------------------- customer reviews

const CUSTOMER_REVIEW_LIMIT = 20;      // cap on reviews collected overall
const MIN_INLINE_REVIEWS = 3;          // below this, fall back to the reviews page
const REVIEWS_PAGE_MAX_FETCHES = 3;    // safety cap on network fetches
const REVIEW_FETCH_TIMEOUT_MS = 10000; // per-page fetch stall cap

/** fetch + read with a hard timeout; returns text or null (never hangs). */
async function fetchPageText(url, timeoutMs = REVIEW_FETCH_TIMEOUT_MS) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, { credentials: 'include', signal: controller.signal });
    if (!response.ok) return null;
    return await response.text();
  } catch (_) {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

/** Collapse whitespace and drop Amazon chrome ("Verified Purchase", "Read more"). */
function cleanReviewText(text) {
  return String(text || '')
    .replace(/Verified Purchase/gi, '')
    .replace(/\bRead more\b/gi, '')
    .replace(/\s+/g, ' ')
    .trim();
}

/** Parse one review card — supports both markup generations:
 *  product-page cards (camelCase hooks: reviewTitle/reviewText) and
 *  customer-reviews pages (kebab hooks: review-title/review-body). */
function parseCustomerReview(node) {
  const ratingEl = node.querySelector('[data-hook="review-star-rating"] .a-icon-alt, [data-hook="cmps-review-star-rating"] .a-icon-alt, .a-icon-alt');
  const ratingMatch = (ratingEl?.textContent || '').match(/([\d.]+)\s+out of 5/i);
  const rating = ratingMatch ? ratingMatch[1] : '';

  const titleEl = node.querySelector('[data-hook="reviewTitle"], [data-hook="review-title"]');
  let title = '';
  if (titleEl) {
    const clone = titleEl.cloneNode(true);
    clone.querySelectorAll('.a-icon-alt, i.a-icon, span.a-icon-alt').forEach((n) => n.remove());
    title = cleanReviewText(clone.textContent);
  }

  const bodyEl = node.querySelector('[data-hook="reviewText"], [data-hook="review-body"]');
  const body = cleanReviewText(bodyEl?.textContent || '');
  const date = cleanReviewText(node.querySelector('[data-hook="review-date"]')?.textContent || '');

  if (!body && !title) return null;
  return { title, rating, date, body };
}

function parseCustomerReviews(nodes) {
  const reviews = [];
  const seen = new Set();
  for (const node of nodes) {
    const review = parseCustomerReview(node);
    if (!review) continue;
    const fingerprint = `${review.title}|${review.body.slice(0, 80)}`;
    if (seen.has(fingerprint)) continue;
    seen.add(fingerprint);
    reviews.push(review);
    if (reviews.length >= CUSTOMER_REVIEW_LIMIT) break;
  }
  return reviews;
}

/** Parse a customer-reviews HTML page string into review objects. */
function parseCustomerReviewsHtml(html) {
  const doc = new DOMParser().parseFromString(html, 'text/html');
  return parseCustomerReviews(doc.querySelectorAll('[data-hook="review"]'));
}

function reviewsPageUrl(asin, pageNumber) {
  const params = new URLSearchParams({ pageNumber: String(pageNumber), filterByStar: 'five_star', reviewerType: 'all_reviews' });
  return `https://www.amazon.com/product-reviews/${asin}/?${params.toString()}`;
}

/**
 * Read the customer reviews already posted for this product. Tries the reviews
 * rendered on the product page first, then the five-star customer-reviews page
 * (fetched with the page's own session so the popup never hits Amazon).
 */
async function extractCustomerReviews() {
  let reviews = parseCustomerReviews(document.querySelectorAll('[data-hook="review"]'));

  // We post five-star reviews, so when enough 5★ examples exist, drop the rest.
  const fiveStar = reviews.filter((r) => Number(r.rating) === 5);
  if (fiveStar.length >= MIN_INLINE_REVIEWS) reviews = fiveStar;

  const asin = currentAsin();
  if (reviews.length < MIN_INLINE_REVIEWS && asin) {
    const seen = new Set(reviews.map((r) => `${r.title}|${r.body.slice(0, 80)}`));
    const merge = (pageReviews) => {
      for (const review of pageReviews) {
        const fingerprint = `${review.title}|${review.body.slice(0, 80)}`;
        if (seen.has(fingerprint)) continue;
        seen.add(fingerprint);
        reviews.push(review);
        if (reviews.length >= CUSTOMER_REVIEW_LIMIT) return;
      }
    };

    for (let page = 1; page <= REVIEWS_PAGE_MAX_FETCHES && reviews.length < CUSTOMER_REVIEW_LIMIT; page++) {
      const before = reviews.length;
      const html = await fetchPageText(reviewsPageUrl(asin, page));
      if (html) merge(parseCustomerReviewsHtml(html));
      // No page 2 when page 1 added nothing (no more five-star reviews).
      if (reviews.length === before) break;
    }
  }

  return reviews;
}

function getProductTitle() {
  return document.querySelector('#productTitle')?.textContent?.trim() || null;
}

// Optionally bump when content.js changes materially; popup.js only trusts
// pings that report at least its required version (see REQUIRED_CONTENT_VERSION).
const CONTENT_SCRIPT_VERSION = 2;

/** Local ASIN fallback when storage-keys.js wasn't injected alongside us. */
function asinFromLocation() {
  const href = window.location.href || '';
  const dpMatch = href.match(/\/dp\/([A-Z0-9]{10})/);
  if (dpMatch && dpMatch[1]) return dpMatch[1];
  const asinMatch = href.match(/[?&]asin=([A-Z0-9]{10})/);
  return (asinMatch && asinMatch[1]) || null;
}

function currentAsin() {
  return typeof extractAsin === 'function' ? extractAsin() : asinFromLocation();
}

chrome.runtime.onMessage.addListener((request, _sender, sendResponse) => {
  switch (request?.action) {
    case 'ping':
      sendResponse({ status: 'ok', version: CONTENT_SCRIPT_VERSION });
      break;
    case 'getProductTitle':
      sendResponse({ title: getProductTitle() });
      break;
    case 'getProductInfo':
      sendResponse({ productInfo: extractProductInfo() });
      break;
    case 'getExistingReviews':
      // Async: keep the message channel open until the scraper settles.
      extractCustomerReviews()
        .then((reviews) => sendResponse({ reviews }))
        .catch((error) => sendResponse({ reviews: [], error: error?.message || String(error) }));
      return true;
    case 'getAsin':
      sendResponse({ asin: currentAsin() });
      break;
    default:
      break;
  }
  return false; // all other handlers are synchronous
});
})();
