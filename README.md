# Amazon Review Writer Chrome Extension

A Chrome extension that automatically generates product reviews for Amazon products using Google's Gemini AI. This extension helps users create detailed, honest reviews by analyzing product information and generating well-structured content.

## Features

- Extracts product title and description from Amazon product pages
- Generates detailed, honest reviews using Google's Gemini AI
- Simple and intuitive user interface
- Works on any Amazon product page
- Customizable review generation with additional instructions
- Secure API key management

## Prerequisites

- Google Chrome browser
- Google Cloud account with Gemini API access
- Gemini API key

## Installation

1. Clone this repository:
   ```bash
   git clone https://github.com/YOUR_USERNAME/review-writer-extension.git
   ```

2. Create a `key.txt` file in the extension directory and add your Gemini API key:
   ```
   YOUR_GEMINI_API_KEY
   ```

3. Create a `prompt.txt` file in the extension directory with your system prompt for review generation.

4. Open Chrome and navigate to `chrome://extensions/`

5. Enable "Developer mode" in the top right corner

6. Click "Load unpacked" and select the extension directory

## Usage

1. Navigate to any Amazon product page
2. Click the extension icon in your Chrome toolbar
3. (Optional) Add any specific instructions for the review generation
4. Click "Generate Review" to create a review
5. The generated review will be displayed in the popup
6. Copy the review and paste it into Amazon's review section

## Project Structure

- `manifest.json`: Extension configuration and permissions
- `popup.html`: User interface for the extension popup
- `popup.js`: Popup functionality and user interaction
- `content.js`: Product information extraction and review generation logic
- `background.js`: Background service worker for extension functionality
- `key.txt`: Stores the Gemini API key (not tracked in git)
- `prompt.txt`: Contains the system prompt for review generation

## Security Notes

- The API key is stored locally in `key.txt`
- `key.txt` is included in `.gitignore` to prevent accidental commits
- The extension only accesses product information from Amazon pages
- No user data is collected or stored


## License

MIT License
