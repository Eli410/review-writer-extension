class TypingSimulator {
  constructor(options = {}) {
    this.wpm = options.wpm || 60; // Default 60 WPM
    this.variation = options.variation || 0.2; // 20% variation in typing speed
    this.pauseProbability = options.pauseProbability || 0.1; // 10% chance of a pause
    this.pauseDuration = options.pauseDuration || 500; // Pause duration in ms
    this.typingQueue = [];
    this.isTyping = false;
    this.currentElement = null;
    this.currentText = '';
    this.currentIndex = 0;
    this.isPaused = false;
    
    // New properties for natural typing
    this.typoProbability = options.typoProbability || 0.05; // 5% chance of typo
    this.longPauseDuration = options.longPauseDuration || 2000; // 2 second long pause
    this.longPausesRemaining = Math.floor(Math.random() * 3) + 1; // Random number of pauses between 1 and 3
    this.commonTypos = {
      'a': ['s', 'q', 'w'],
      'e': ['w', 'r', 'd'],
      'i': ['u', 'o', 'k'],
      'o': ['i', 'p', 'l'],
      't': ['y', 'r', 'g'],
      'n': ['b', 'm', 'h'],
      's': ['a', 'd', 'w'],
      'r': ['e', 't', 'f'],
      'h': ['j', 'g', 'n'],
      'l': ['k', ';', 'o']
    };

    // Handle visibility change
    document.addEventListener('visibilitychange', () => {
      if (document.hidden) {
        this.pauseTyping();
      } else if (this.currentElement && document.activeElement === this.currentElement) {
        this.resumeTyping();
      }
    });

    // Handle focus change
    document.addEventListener('focusin', (event) => {
      if (this.currentElement && event.target === this.currentElement) {
        this.resumeTyping();
      }
    });

    document.addEventListener('focusout', (event) => {
      if (this.currentElement && event.target === this.currentElement) {
        this.pauseTyping();
      }
    });
  }

  // Calculate delay between keystrokes based on WPM
  calculateDelay() {
    const baseDelay = (60 * 1000) / (this.wpm * 5); // Convert WPM to ms per character
    const variation = baseDelay * this.variation;
    return baseDelay + (Math.random() * variation * 2 - variation);
  }

  // Simulate a human pause with more variety
  async simulatePause(lastChar) {
    const random = Math.random();
    const endPunct = ['.', '!', '?'];

    // 50% chance of a long pause after sentence-ending punctuation
    if (endPunct.includes(lastChar) && random < 0.5) {
      await new Promise(r => setTimeout(r, this.longPauseDuration));
      return;
    }

    // Otherwise, short pause with configured probability
    if (random < this.pauseProbability) {
      await new Promise(r => setTimeout(r, this.pauseDuration));
    }
  }


  // Simulate clicking to focus an element
  async focusElement(element) {
    // Only focus if not already focused
    if (document.activeElement !== element) {
      // Simulate mouse click
      const clickEvent = new MouseEvent('click', {
        bubbles: true,
        cancelable: true,
        view: window
      });
      element.dispatchEvent(clickEvent);
      
      // Focus the element
      element.focus();
      
      // Select all text if it's not empty
      if (element.value) {
        element.setSelectionRange(0, element.value.length);
      }
      
      // Small delay after focusing
      await new Promise(resolve => setTimeout(resolve, 100));
    }
  }

  // Pause typing
  pauseTyping() {
    this.isPaused = true;
  }

  // Resume typing
  async resumeTyping() {
    if (!this.isPaused || !this.currentElement || !this.currentText) return;
    
    this.isPaused = false;
    // Continue typing from where we left off
    await this.continueTyping();
  }

  // Continue typing from current position
  async continueTyping() {
    if (!this.currentElement || !this.currentText || this.isPaused) return;

    for (let i = this.currentIndex; i < this.currentText.length; i++) {
      if (this.isPaused || document.hidden || document.activeElement !== this.currentElement) {
        this.currentIndex = i;
        return;
      }
      await this.typeCharacter(this.currentElement, this.currentText[i]);
    }

    this.currentElement = null;
    this.currentText = '';
    this.currentIndex = 0;
    this.isTyping = false;

    // Process next item in queue if any
    if (this.typingQueue.length > 0) {
      const next = this.typingQueue.shift();
      this.typeText(next.element, next.text);
    }
  }

  // Create a keyboard event with proper properties
  createKeyboardEvent(type, key, keyCode, which) {
    return new KeyboardEvent(type, {
      key: key,
      code: key,
      keyCode: keyCode,
      which: which,
      bubbles: true,
      cancelable: true,
      view: window
    });
  }

  // Generate a typo for a given character
  generateTypo(char) {
    const lowerChar = char.toLowerCase();
    if (this.commonTypos[lowerChar]) {
      const possibleTypos = this.commonTypos[lowerChar];
      return possibleTypos[Math.floor(Math.random() * possibleTypos.length)];
    }
    // If no common typo exists, return a nearby key on QWERTY keyboard
    return String.fromCharCode(char.charCodeAt(0) + (Math.random() > 0.5 ? 1 : -1));
  }

  // Simulate backspace to correct a typo
  async simulateBackspace(element) {
    const backspaceEvent = this.createKeyboardEvent('keydown', 'Backspace', 8, 8);
    element.dispatchEvent(backspaceEvent);
    
    element.value = element.value.slice(0, -1);
    
    element.dispatchEvent(new Event('input', { bubbles: true }));
    
    const keyupEvent = this.createKeyboardEvent('keyup', 'Backspace', 8, 8);
    element.dispatchEvent(keyupEvent);
    
    // Add a small delay after backspace
    await new Promise(resolve => setTimeout(resolve, 100 + Math.random() * 200));
  }

  // Type a single character with potential typos
  async typeCharacter(element, char) {
    // Decide if we should make a typo
    if (Math.random() < this.typoProbability) {
      // Generate and type a typo
      const typo = this.generateTypo(char);
      const keyCode = typo.charCodeAt(0);
      
      // Type the typo
      element.dispatchEvent(this.createKeyboardEvent('keydown', typo, keyCode, keyCode));
      element.dispatchEvent(this.createKeyboardEvent('keypress', typo, keyCode, keyCode));
      element.value += typo;
      element.dispatchEvent(new Event('input', { bubbles: true }));
      element.dispatchEvent(this.createKeyboardEvent('keyup', typo, keyCode, keyCode));
      
      // Add a small delay before correction
      await new Promise(resolve => setTimeout(resolve, 200 + Math.random() * 300));
      
      // Simulate backspace to correct the typo
      await this.simulateBackspace(element);
      
      // Add a small delay after correction
      await new Promise(resolve => setTimeout(resolve, 100 + Math.random() * 200));
    }
    
    // Type the correct character
    const keyCode = char.charCodeAt(0);
    
    // Dispatch keydown event
    element.dispatchEvent(this.createKeyboardEvent('keydown', char, keyCode, keyCode));
    
    // Dispatch keypress event
    element.dispatchEvent(this.createKeyboardEvent('keypress', char, keyCode, keyCode));
    
    // Update the element value
    element.value += char;
    
    // Dispatch input event
    element.dispatchEvent(new Event('input', { bubbles: true }));
    
    // Dispatch keyup event
    element.dispatchEvent(this.createKeyboardEvent('keyup', char, keyCode, keyCode));
    
    // Add a small random delay between events to simulate human typing
    const eventDelay = Math.random() * 50; // Random delay between 0-50ms
    await new Promise(resolve => setTimeout(resolve, eventDelay));
    
    // Add the main typing delay
    await new Promise(resolve => setTimeout(resolve, this.calculateDelay()));
    await this.simulatePause(char);

  }

  // Type a string with human-like behavior
  async typeText(element, text) {
    if (this.isTyping) {
      this.typingQueue.push({ element, text });
      return;
    }

    this.isTyping = true;
    this.currentElement = element;
    this.currentText = text;
    this.currentIndex = 0;
    element.value = '';
    
    // Focus the element before starting to type
    await this.focusElement(element);

    // Start typing if the element is focused and tab is visible
    if (document.activeElement === element && !document.hidden) {
      await this.continueTyping();
    } else {
      this.isPaused = true;
    }
  }

  // Stop current typing and clear queue
  stop() {
    this.isTyping = false;
    this.isPaused = true;
    this.typingQueue = [];
    this.currentElement = null;
    this.currentText = '';
    this.currentIndex = 0;
  }
}

// Export the class
window.TypingSimulator = TypingSimulator; 