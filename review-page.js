/**
 * Runs on the Amazon "review your purchases" page. Fills the star rating,
 * title, and body with the stored review for this ASIN (or an explicit review
 * passed via message) using the human-like typing simulator. Retries until
 * the form fields actually exist instead of using fixed delays.
 */

const FIELD_SELECTORS = { title: '#reviewTitle', body: '#reviewText' };
const FIELD_WAIT_TIMEOUT_MS = 10000;
const FIELD_POLL_INTERVAL_MS = 250;

async function waitForReviewFields(timeoutMs = FIELD_WAIT_TIMEOUT_MS) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const fields = {
      title: document.querySelector(FIELD_SELECTORS.title),
      body: document.querySelector(FIELD_SELECTORS.body),
    };
    if (fields.title || fields.body) return fields;
    await new Promise((r) => setTimeout(r, FIELD_POLL_INTERVAL_MS));
  }
  return { title: null, body: null };
}

function selectFiveStarRating() {
  const fiveStar =
    document.querySelector('span[aria-label="select to rate item five star."]') ||
    document.querySelector('.in-context-ryp__form-field--starRating .in-context-ryp__form-field--starRating-single:nth-child(5)');
  if (fiveStar) {
    fiveStar.click();
    return true;
  }
  console.log('Star rating (5 stars) not found; continuing without setting rating.');
  return false;
}

async function getStoredReviewText() {
  const asin = extractAsin();
  if (!asin) return null;
  try {
    const storageKey = getStorageKey('review', asin);
    const result = await chrome.storage.local.get(storageKey);
    return result[storageKey] || null;
  } catch (error) {
    console.error('Error getting stored review:', error);
    return null;
  }
}

/**
 * Type the review into the form. Returns true when the body textarea got
 * filled. Never types placeholder junk into empty fields — leaves them
 * untouched so the user can type their own review.
 */
async function fillReviewForm(reviewText = null) {
  const { title: titleInput, body: reviewTextarea } = await waitForReviewFields();
  if (!reviewTextarea && !titleInput) {
    console.log('Review form fields not found.');
    return false;
  }

  selectFiveStarRating();

  const sourceText = reviewText != null ? String(reviewText) : await getStoredReviewText();
  if (!sourceText || !sourceText.trim()) {
    console.log('No stored review for this product; nothing to fill.');
    return false;
  }

  const { title, review } = parseReviewText(sourceText);
  if (!review && !title) {
    console.log('Stored review was empty after parsing.');
    return false;
  }

  const typingSimulator = new TypingSimulator({
    wpm: 150,
    variation: 0.3,
    pauseProbability: 0.15,
    pauseDuration: 200,
    typoProbability: 0.02,
    longPauseProbability: 0.05,
    longPauseDuration: 1500,
  });

  // Skip fields that already have content (e.g. a previous fill attempt) so
  // a duplicate "poke" message doesn't re-type over finished text.
  if (titleInput && title && !titleInput.value.trim()) {
    await typingSimulator.typeText(titleInput, title);
    console.log('Review title filled.');
  } else if (titleInput && title) {
    console.log('Review title already filled; skipping.');
  }

  if (reviewTextarea && review) {
    if (!reviewTextarea.value.trim()) {
      await typingSimulator.typeText(reviewTextarea, review);
      console.log('Review body filled.');
    } else {
      console.log('Review body already filled; skipping.');
    }
    return true;
  }

  return false;
}

(async function runOnLoad() {
  try {
    await fillReviewForm();
  } catch (error) {
    console.error('Auto-fill failed:', error);
  }
})();

// Message from the popup (sent after opening this tab) as a backstop for the
// auto-run: if the form loaded faster/slower than expected, fill now.
chrome.runtime.onMessage.addListener((request, _sender, sendResponse) => {
  if (request?.action === 'fillReviewTextarea') {
    fillReviewForm(request.reviewText)
      .then((success) => sendResponse({ success }))
      .catch((error) => {
        console.error('fillReviewTextarea failed:', error);
        sendResponse({ success: false, error: error?.message || 'unknown' });
      });
    return true; // asynchronous response
  }
  return false;
});
