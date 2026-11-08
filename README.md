# Amazon Review Writer Chrome Extension

A Chrome extension (Manifest V3) that generates product reviews for Amazon products using OpenRouter. Default model: `anthropic/claude-haiku-5.5` — recent, low cost ($0.10/$0.50 per 1M tokens), and strong at the casual, human-sounding style this extension targets. Alternatives (GPT-6 Luna, DeepSeek V4.1 Flash, Gemini 3.8 Flash) are selectable in Settings.

## Features

- Extracts product title, description, features, price, and rating from Amazon product pages
- Generates a reviewer persona, key aspects, and the review itself in a **single LLM call** for fresh products (previously three sequential calls)
- Remembers the review, persona, and aspects per product (ASIN), so reopening costs nothing
- Per-section regenerate buttons: persona, aspects, review
- Human-like form filling on the Amazon review page (typing simulator with natural typos and pauses)
- Robust API layer: timeouts, retries with backoff on transient errors, and clear messages for bad keys / no credits / rate limits
- API key is set in the Settings tab (stored locally) or via a `.env` fallback; a "Test key" button validates it without spending tokens

## Prerequisites

- Google Chrome
- An OpenRouter API key (https://openrouter.ai/keys)

## Installation

1. Clone this repository:
   ```bash
   git clone https://github.com/YOUR_USERNAME/review-writer-extension.git
   ```

2. Pick **one** way to provide the API key:
   - **Settings tab (recommended):** after loading the extension, open the popup → Settings → enter the key → Save key → Test key to verify.
   - **`.env` file:** create `.env` in the extension directory:
     ```
     OPENROUTER_API_KEY=YOUR_OPENROUTER_API_KEY
     ```

3. Open `chrome://extensions/`, enable "Developer mode", click "Load unpacked", and select the extension directory.

## Usage

1. Navigate to any Amazon product page
2. Click the extension icon — the review generates automatically on first open
3. Edit the persona or aspects freely, then hit the regenerate buttons as needed
4. Click "Write Review" to open Amazon's review page — the form fills itself (5 stars, title, body)
5. Reopening the popup for the same product loads the remembered review without any new API calls

## Project Structure

- `manifest.json`: extension configuration and permissions
- `popup.html` / `popup.js`: UI + orchestration (all LLM requests go directly popup → background)
- `background.js`: service worker; the only place that talks to OpenRouter (key resolution, retries, error mapping, system prompt)
- `content.js`: Amazon page scraper (no LLM logic)
- `prompts.js`: centralized prompt builders (persona / aspects / review / combined)
- `storage-keys.js`: shared helpers (storage keys, ASIN extraction, LLM JSON cleanup, review text parsing)
- `review-page.js` + `typing-simulator.js`: fill the Amazon review form with human-like typing
- `config.js`: provider/model list shared by the popup and the service worker
- `prompt.txt`: system prompt defining review voice
- `test/`: node-based tests — LLM smoke test (`test/llm-smoke.mjs`, needs `.env`), popup flow integration test (`test/popup-flow.test.mjs`), review-page flow test (`test/review-page.test.mjs`), shared-helper parse tests (inline in `llm-smoke.mjs`)
- `.env`: optional API key fallback (not tracked in git)

## Security Notes

- The API key is stored locally: `chrome.storage.local` (Settings tab) or a gitignored `.env`
- The service worker is the only component with network access to OpenRouter
- No user data is collected or transmitted anywhere other than OpenRouter requests

## License

MIT License
