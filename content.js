/**
 * Content script for all Amazon product pages. Pure scraper: the popup drives
 * everything (LLM calls go popup → background service worker, never through
 * this script). Keep it small so injection stays fast.
 */

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

function getProductTitle() {
  return document.querySelector('#productTitle')?.textContent?.trim() || null;
}

chrome.runtime.onMessage.addListener((request, _sender, sendResponse) => {
  switch (request?.action) {
    case 'ping':
      sendResponse({ status: 'ok' });
      break;
    case 'getProductTitle':
      sendResponse({ title: getProductTitle() });
      break;
    case 'getProductInfo':
      sendResponse({ productInfo: extractProductInfo() });
      break;
    case 'getAsin':
      sendResponse({ asin: extractAsin() });
      break;
    default:
      break;
  }
  return false; // all handlers are synchronous
});
