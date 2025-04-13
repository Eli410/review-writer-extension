# Amazon Review Writer Chrome Extension

A Chrome extension that automatically generates product reviews for Amazon products using Google's Gemini AI.

## Features

- Extracts product information from Amazon product pages
- Generates detailed, honest reviews using Gemini AI
- Simple and intuitive user interface
- Works on any Amazon product page

## Installation

1. Clone this repository
2. Open Chrome and navigate to `chrome://extensions/`
3. Enable "Developer mode" in the top right corner
4. Click "Load unpacked" and select the extension directory

## Usage

1. Navigate to any Amazon product page
2. Click the extension icon in your Chrome toolbar
3. Click "Generate Review" to create a review
4. The generated review will be displayed in the popup

## Development

The extension consists of the following files:
- `manifest.json`: Extension configuration
- `popup.html`: User interface
- `popup.js`: Popup functionality
- `content.js`: Product information extraction and review generation
- `icons/`: Extension icons

## TODO

- [ ] Implement Gemini API integration
- [ ] Add review customization options
- [ ] Add review history
- [ ] Implement review saving functionality

## License

MIT License 