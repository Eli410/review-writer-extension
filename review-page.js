// Function to extract ASIN from URL
function extractAsinFromUrl() {
  const url = window.location.href;
  
  // Extract ASIN from URL parameter
  const asinMatch = url.match(/[?&]asin=([A-Z0-9]{10})/);
  if (asinMatch && asinMatch[1]) {
    return asinMatch[1];
  }
  
  return null;
}

// Function to parse review text to separate title and review
function parseReviewText(text) {
  console.log('Parsing review text:', text);
  
  // Default values
  let title = 'Product Review';
  let review = text || '';
  
  try {
    // Try JSON first
    try {
      const parsed = JSON.parse(text);
      if (parsed && typeof parsed === 'object') {
        if (typeof parsed.title === 'string') {
          title = parsed.title.trim();
        }
        if (typeof parsed.review === 'string') {
          review = parsed.review.trim();
        }
        return { title, review };
      }
    } catch (jsonErr) {
      // Not JSON, continue
    }
    
    // Try to extract title and review using the format
    const titleMatch = text.match(/Title:\s*([^\n]+)/i);
    const reviewMatch = text.match(/Review:\s*([\s\S]+?)(?=\n\nTitle:|$)/i);
    
    if (titleMatch && reviewMatch) {
      title = titleMatch[1].trim();
      review = reviewMatch[1].trim();
    } else {
      // If the format is not found, try to split by paragraphs
      const paragraphs = text.split('\n\n').filter(p => p.trim());
      
      if (paragraphs.length >= 2) {
        // Assume first paragraph is review, second is title
        review = paragraphs[0].trim();
        title = paragraphs[1].trim();
      } else if (paragraphs.length === 1) {
        // If only one paragraph, use it as the review
        review = paragraphs[0].trim();
      }
    }
    
    // Strip leading label if still present
    review = review.replace(/^Review:\s*/i, '').trim();
    
    console.log('Parsed title:', title);
    console.log('Parsed review:', review);
    
    return { title, review };
  } catch (error) {
    console.error('Error parsing review text:', error);
    // Return the original text as review if parsing fails
    return { title: 'Product Review', review: text };
  }
}

// Select the 5-star rating on the Amazon review form (in-context RYP)
function selectFiveStarRating() {
  const fiveStar =
    document.querySelector('span[aria-label="select to rate item five star."]') ||
    document.querySelector('.in-context-ryp__form-field--starRating .in-context-ryp__form-field--starRating-single:nth-child(5)');
  if (fiveStar) {
    fiveStar.click();
  } else {
    console.log('Star rating (5 stars) not found; continuing without setting rating.');
  }
}

// Function to fill the review form with stored review
async function fillReviewForm(reviewText = null) {
  selectFiveStarRating();

  // Find the review title input element
  const reviewTitleInput = document.querySelector('#reviewTitle');
  // Find the review textarea element
  const reviewTextarea = document.querySelector('#reviewText');
  
  let title = '';
  let review = '';
  
  // If review text is provided, parse it to get title and review
  if (reviewText) {
    const parsed = parseReviewText(reviewText);
    title = parsed.title;
    review = parsed.review;
  } else {
    // Get the ASIN from the URL
    const asin = extractAsinFromUrl();
    
    if (asin) {
      try {
        const storageKey =
          typeof getStorageKey === 'function' ? getStorageKey('review', asin) : `review_${asin}`;
        const result = await chrome.storage.local.get(storageKey);
        const storedReview = result[storageKey];
        
        if (storedReview) {
          // Parse the stored review to get title and review
          const parsed = parseReviewText(storedReview);
          title = parsed.title;
          review = parsed.review;
        }
      } catch (error) {
        console.error('Error getting stored review:', error);
      }
    }
    
    // If no stored review, use placeholders
    if (!title) title = "What's most important to know?";
    if (!review) review = "Write your review here...";
  }
  
  // Create typing simulator instance
  const typingSimulator = new TypingSimulator({
    wpm: 150, // Adjust WPM as needed
    variation: 0.3,
    pauseProbability: 0.15,
    pauseDuration: 200,
    // Natural typing options
    typoProbability: 0.02, // 2% chance of typo
    longPauseProbability: 0.05, // 2% chance of long pause
    longPauseDuration: 1500, // 2 second long pause
  });
  
  // Fill the title input if it exists
  if (reviewTitleInput) {
    await typingSimulator.typeText(reviewTitleInput, title);
    console.log('Review title input filled with:', title);
  } else {
    console.log('Review title input not found');
  }
  
  // Fill the review textarea if it exists
  if (reviewTextarea) {
    await typingSimulator.typeText(reviewTextarea, review);
    console.log('Review textarea filled with:', review);
    return true;
  } else {
    console.log('Review textarea not found');
    return false;
  }
}

// Try to fill the form immediately
let filled = false;
setTimeout(() => {
  filled = fillReviewForm();
  
  // If not filled, try again after a short delay (in case the page is still loading)
  if (!filled) {
    setTimeout(() => {
      fillReviewForm();
    }, 1000);
  }
}, 2000); // 2 second delay

// Listen for messages from the extension
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.action === 'fillReviewTextarea') {
    const result = fillReviewForm(request.reviewText);
    sendResponse({ success: result });
    return true; // Will respond asynchronously
  }
  return true; // Will respond asynchronously
}); 
