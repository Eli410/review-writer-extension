/**
 * Provider and model configuration. Used by background.js (importScripts).
 * Model IDs must match the options in sidepanel Settings UI.
 */
const PROVIDER_CONFIG = {
  openrouter: {
    defaultModel: 'anthropic/claude-haiku-4.5',
    models: [
      { id: 'anthropic/claude-haiku-4.5', label: 'Claude Haiku 4.5' },
      { id: 'google/gemini-3-flash-preview', label: 'Gemini 3 Flash (Preview)' },
      { id: 'openai/gpt-5-mini', label: 'GPT-5 Mini' },
      { id: 'moonshotai/kimi-k2.5', label: 'Kimi K2.5' },
    ],
  },
};
