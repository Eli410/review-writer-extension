/**
 * Provider and model configuration. Loaded by:
 *  - background.js via importScripts()
 *  - popup.html via <script> (before popup.js)
 * so both always agree on a single model list.
 */
const PROVIDER_CONFIG = {
  openrouter: {
    // Claude Haiku 5.5 (Oct 2026): strong casual writing, $0.10/$0.50 per 1M tokens.
    defaultModel: 'anthropic/claude-haiku-5.5',
    models: [
      { id: 'anthropic/claude-haiku-5.5', label: 'Claude Haiku 5.5' },
      { id: 'openai/gpt-6-luna', label: 'GPT-6 Luna' },
      { id: 'deepseek/deepseek-v4.1-flash-1017', label: 'DeepSeek V4.1 Flash' },
      { id: 'google/gemini-3.8-flash', label: 'Gemini 3.8 Flash' },
    ],
  },
};
