const axios = require('axios');
const config = require('../config');

/**
 * Universal AI chat completion router.
 * Dispatches requests to the provider configured for the specific feature (or custom options).
 * Supports automatic key rotation / failover if multiple keys are present.
 *
 * @param {string} featureName - The name of the feature defined in config.features (e.g. 'todo')
 * @param {Array<{role: string, content: string}>} messages - Chat completion messages
 * @param {Object} [overrideOptions] - Optional overrides for model, provider, temperature, etc.
 * @returns {Promise<string>} The assistant's text response content
 */
async function getChatCompletionForFeature(featureName, messages, overrideOptions = {}) {
  const featureConfig = config.features[featureName] || {};
  const provider = (overrideOptions.provider || featureConfig.provider || 'groq').toLowerCase();
  const model = overrideOptions.model || featureConfig.model;
  const temperature = overrideOptions.temperature ?? featureConfig.temperature ?? 0.1;
  const maxTokens = overrideOptions.maxTokens ?? featureConfig.maxTokens ?? 100;

  const providerConfig = config.aiProviders[provider];
  if (!providerConfig) {
    throw new Error(`Unsupported AI provider: "${provider}" requested by feature "${featureName}".`);
  }

  const keys = providerConfig.keys;
  if (!keys || keys.length === 0) {
    throw new Error(`No API keys found for AI provider: "${provider}". Please set environment variables.`);
  }

  let lastError = null;

  for (let i = 0; i < keys.length; i++) {
    const apiKey = keys[i];
    try {
      const response = await axios.post(
        providerConfig.endpoint,
        {
          model,
          messages,
          temperature,
          max_tokens: maxTokens
        },
        {
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${apiKey}`
          },
          timeout: 20000
        }
      );

      const choice = response.data?.choices?.[0]?.message;
      let text = choice?.content?.trim() || '';

      // If text content was empty but reasoning is present (e.g. some deepseek/oss reasoning models)
      if (!text && choice?.reasoning) {
        text = choice.reasoning.trim();
      }

      return text;
    } catch (err) {
      lastError = err;
      const status = err?.response?.status;
      const errMsg = err?.response?.data?.error?.message || err.message;
      console.warn(`[AIClient] Provider "${provider}" key index ${i} failed (Status: ${status}): ${errMsg}`);

      // If it's a 4xx error other than rate limit / auth (e.g. bad prompt), don't keep rotating keys pointlessly
      if (status && status !== 429 && status !== 401 && status !== 403) {
        throw err;
      }
    }
  }

  throw lastError || new Error(`All keys failed for AI provider "${provider}".`);
}

/**
 * Generate a short 4-5 word summary title for a task using the configured feature model.
 * Falls back safely to plain string truncation on error.
 *
 * @param {string} taskText
 * @returns {Promise<string>}
 */
async function generateTaskTitle(taskText) {
  if (!taskText) return '';
  const fallback = taskText.substring(0, 40);

  try {
    const aiPrompt = `Translate the following task into a very short, concise title (maximum 4-5 words) summarizing it. Return ONLY the title, no extra text, no markdown, no quotes.\n\nTask: ${taskText}`;
    
    const generatedTitle = await getChatCompletionForFeature('todo', [
      { role: 'user', content: aiPrompt }
    ]);

    if (generatedTitle) {
      return generatedTitle.replace(/^["']|["']$/g, '');
    }
  } catch (err) {
    console.error('[aiUtils] Error generating task title with AI (using fallback):', err?.response?.data?.error?.message || err.message);
  }

  return fallback;
}

module.exports = {
  getChatCompletionForFeature,
  generateTaskTitle
};
