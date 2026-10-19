const axios = require('axios');
const config = require('../config');

// Concurrency-aware key tracking state
const providerKeyPools = new Map();
const waiterQueues = new Map();

function getKeyPool(provider, keys) {
  if (!providerKeyPools.has(provider)) {
    providerKeyPools.set(
      provider,
      keys.map((key, index) => ({ key, index, isProcessing: false }))
    );
    waiterQueues.set(provider, []);
  }
  return {
    keyPool: providerKeyPools.get(provider),
    waiters: waiterQueues.get(provider)
  };
}

async function acquireFreeKey(provider, keyPool, waiters, triedIndices) {
  const available = keyPool.find(k => !k.isProcessing && !triedIndices.has(k.index));
  if (available) {
    available.isProcessing = true;
    return available;
  }

  return new Promise((resolve) => {
    waiters.push({
      triedIndices,
      resolve: (keyObj) => {
        keyObj.isProcessing = true;
        resolve(keyObj);
      }
    });
  });
}

function releaseKey(keyObj, waiters) {
  keyObj.isProcessing = false;
  const waiterIdx = waiters.findIndex(w => !w.triedIndices.has(keyObj.index));
  if (waiterIdx !== -1) {
    const waiter = waiters.splice(waiterIdx, 1)[0];
    waiter.resolve(keyObj);
  }
}

/**
 * Automatically converts remote HTTP image URLs in vision messages to base64 data URIs
 * for compatibility with OpenAI-compatible endpoints like Gemini.
 */
async function resolveImageUrls(messages) {
  if (!Array.isArray(messages)) return messages;

  const newMessages = [];
  for (const message of messages) {
    if (!message || !Array.isArray(message.content)) {
      newMessages.push(message);
      continue;
    }

    const newContent = [];
    for (const item of message.content) {
      if (item?.type === 'image_url' && typeof item.image_url?.url === 'string') {
        const url = item.image_url.url;
        if (url.startsWith('http://') || url.startsWith('https://')) {
          try {
            console.log(`[AIClient] Pre-resolving remote image URL: ${url.substring(0, 60)}...`);
            const imageRes = await axios.get(url, { responseType: 'arraybuffer', timeout: 15000 });
            const contentType = imageRes.headers['content-type'] || 'image/jpeg';
            const base64Image = Buffer.from(imageRes.data).toString('base64');
            newContent.push({
              ...item,
              image_url: {
                ...item.image_url,
                url: `data:${contentType};base64,${base64Image}`
              }
            });
            continue;
          } catch (err) {
            console.error(`[AIClient] Failed to convert image URL to base64: ${err.message}`);
          }
        }
      }
      newContent.push(item);
    }
    newMessages.push({ ...message, content: newContent });
  }

  return newMessages;
}

/**
 * Universal AI chat completion router.
 * Dispatches requests to the provider configured for the specific feature (or custom options).
 * Supports automatic concurrency-aware key rotation and failover.
 *
 * @param {string} featureName - The name of the feature defined in config.features (e.g. 'todo')
 * @param {Array<{role: string, content: string|Array}>} messages - Chat completion messages
 * @param {Object} [overrideOptions] - Optional overrides for model, provider, temperature, etc.
 * @returns {Promise<string>} The assistant's text response content
 */
async function getChatCompletionForFeature(featureName, messages, overrideOptions = {}) {
  const featureConfig = config.features[featureName] || {};
  const provider = (overrideOptions.provider || featureConfig.provider || 'gemini').toLowerCase();
  const model = overrideOptions.model || featureConfig.model;
  const temperature = overrideOptions.temperature ?? featureConfig.temperature ?? 0.1;
  const maxTokens = overrideOptions.maxTokens ?? featureConfig.maxTokens ?? 512;

  const providerConfig = config.aiProviders[provider];
  if (!providerConfig) {
    throw new Error(`Unsupported AI provider: "${provider}" requested by feature "${featureName}".`);
  }

  const keys = providerConfig.keys;
  if (!keys || keys.length === 0) {
    throw new Error(`No API keys found for AI provider: "${provider}". Please set environment variables.`);
  }

  const { keyPool, waiters } = getKeyPool(provider, keys);
  const triedIndices = new Set();
  const maxAttempts = keyPool.length;
  let attempts = 0;
  let lastError = null;

  // Pre-process any image URLs to base64
  const processedMessages = await resolveImageUrls(messages);

  while (attempts < maxAttempts) {
    const keyObj = await acquireFreeKey(provider, keyPool, waiters, triedIndices);
    triedIndices.add(keyObj.index);
    attempts++;

    try {
      console.log(`[AIClient] Provider "${provider}" using key index ${keyObj.index} (attempt ${attempts}/${maxAttempts})...`);
      const response = await axios.post(
        providerConfig.endpoint,
        {
          model,
          messages: processedMessages,
          temperature,
          max_tokens: maxTokens
        },
        {
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${keyObj.key}`
          },
          timeout: overrideOptions.timeout || 30000
        }
      );

      releaseKey(keyObj, waiters);

      const choice = response.data?.choices?.[0]?.message;
      let text = choice?.content?.replace(/<think>[\s\S]*?<\/think>/gi, '').trim() || '';

      return text;
    } catch (err) {
      releaseKey(keyObj, waiters);
      lastError = err;

      const status = err?.response?.status;
      const errMsg = err?.response?.data?.error?.message || err.message;
      console.warn(`[AIClient] Provider "${provider}" key index ${keyObj.index} failed (Status: ${status}): ${errMsg}`);

      // If it's a 4xx error not related to rate limits or auth (e.g. invalid request structure), don't keep rotating
      if (status && status !== 429 && status !== 401 && status !== 403 && status !== 503) {
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
