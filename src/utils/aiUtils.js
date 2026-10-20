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
 * for compatibility with OpenAI-compatible endpoints like Gemini and OpenRouter.
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
 * Helper to dispatch a chat completion request to a specific key.
 * Supports cancellation via AbortSignal.
 */
async function sendRequestToKey(providerConfig, model, processedMessages, temperature, maxTokens, keyObj, timeoutMs, signal) {
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
      timeout: timeoutMs,
      signal
    }
  );

  const choice = response.data?.choices?.[0]?.message;
  return choice?.content?.replace(/<think>[\s\S]*?<\/think>/gi, '').trim() || '';
}

/**
 * Race a batch of concurrent requests across multiple keys.
 * Returns the first successful response and aborts the others.
 * If all keys in the batch fail, rejects with the last error.
 */
function raceBatchRequests(batchPromises, abortController) {
  return new Promise((resolve, reject) => {
    let pending = batchPromises.length;
    let lastError = null;
    let resolved = false;

    if (pending === 0) {
      return reject(new Error('No requests in batch.'));
    }

    batchPromises.forEach(({ promise, keyObj }) => {
      promise
        .then((result) => {
          if (!resolved) {
            resolved = true;
            // Abort remaining in-flight requests in this batch
            abortController.abort();
            resolve({ result, winnerKeyObj: keyObj });
          }
        })
        .catch((err) => {
          // Ignore AbortError caused by another key succeeding
          if (!axios.isCancel(err) && err?.name !== 'CanceledError' && err?.name !== 'AbortError') {
            lastError = err;
          }
          pending--;
          if (pending === 0 && !resolved) {
            reject(lastError || new Error('All requests in batch failed.'));
          }
        });
    });
  });
}

/**
 * Executes requests in parallel batches (e.g. 4 keys at once).
 * Races the keys within the batch; first non-error wins and aborts the rest.
 * Returns { result } if successful.
 */
async function executeBatchOfKeys({
  provider,
  providerConfig,
  model,
  processedMessages,
  temperature,
  maxTokens,
  timeoutMs,
  batchKeys,
  waiters
}) {
  const abortController = new AbortController();
  const batchPromises = batchKeys.map((keyObj) => ({
    keyObj,
    promise: (async () => {
      try {
        console.log(`[AIClient] Provider "${provider}" dispatching request with key index ${keyObj.index} (batch of ${batchKeys.length})...`);
        const text = await sendRequestToKey(
          providerConfig,
          model,
          processedMessages,
          temperature,
          maxTokens,
          keyObj,
          timeoutMs,
          abortController.signal
        );
        return text;
      } catch (err) {
        if (!axios.isCancel(err) && err?.name !== 'CanceledError' && err?.name !== 'AbortError') {
          const status = err?.response?.status;
          const errMsg = err?.response?.data?.error?.message || err.message;
          console.warn(`[AIClient] Provider "${provider}" key index ${keyObj.index} failed (Status: ${status}): ${errMsg}`);
        }
        throw err;
      }
    })()
  }));

  try {
    const { result, winnerKeyObj } = await raceBatchRequests(batchPromises, abortController);
    console.log(`[AIClient] Provider "${provider}" key index ${winnerKeyObj.index} completed first successfully!`);
    return result;
  } finally {
    batchKeys.forEach(k => releaseKey(k, waiters));
  }
}

/**
 * Dispatches a request using a 3-stage fallback strategy for vision tasks:
 * Stage 1: First 4 Gemini keys (sent concurrently in parallel, first to succeed wins).
 * Stage 2: Second 4 Gemini keys (sent concurrently in parallel, first to succeed wins).
 * Stage 3: OpenRouter API key using Minimax vision model (minimax/minimax-m3.1-flash:free).
 */
async function executeThreeStageVisionFallback({
  model,
  processedMessages,
  temperature,
  maxTokens,
  timeoutMs
}) {
  const geminiConfig = config.aiProviders.gemini;
  const geminiKeys = geminiConfig?.keys || [];
  const { keyPool: geminiKeyPool, waiters: geminiWaiters } = getKeyPool('gemini', geminiKeys);
  const triedGeminiIndices = new Set();
  let lastError = null;

  // ── Stage 1: First 4 Gemini keys ───────────────────────────────────────────
  console.log('[AIClient] [Stage 1/3] Attempting first 4 Gemini keys in parallel...');
  const stage1Keys = [];
  const count1 = Math.min(4, geminiKeyPool.length);
  for (let i = 0; i < count1; i++) {
    const keyObj = await acquireFreeKey('gemini', geminiKeyPool, geminiWaiters, triedGeminiIndices);
    triedGeminiIndices.add(keyObj.index);
    stage1Keys.push(keyObj);
  }

  try {
    const res = await executeBatchOfKeys({
      provider: 'gemini',
      providerConfig: geminiConfig,
      model,
      processedMessages,
      temperature,
      maxTokens,
      timeoutMs,
      batchKeys: stage1Keys,
      waiters: geminiWaiters
    });
    return res;
  } catch (err) {
    lastError = err;
    console.warn('[AIClient] Stage 1 (first 4 Gemini keys) all failed.');
  }

  // ── Stage 2: Second 4 Gemini keys ──────────────────────────────────────────
  if (geminiKeyPool.length > triedGeminiIndices.size) {
    console.log('[AIClient] [Stage 2/3] Attempting second 4 Gemini keys in parallel...');
    const stage2Keys = [];
    const count2 = Math.min(4, geminiKeyPool.length - triedGeminiIndices.size);
    for (let i = 0; i < count2; i++) {
      const keyObj = await acquireFreeKey('gemini', geminiKeyPool, geminiWaiters, triedGeminiIndices);
      triedGeminiIndices.add(keyObj.index);
      stage2Keys.push(keyObj);
    }

    try {
      const res = await executeBatchOfKeys({
        provider: 'gemini',
        providerConfig: geminiConfig,
        model,
        processedMessages,
        temperature,
        maxTokens,
        timeoutMs,
        batchKeys: stage2Keys,
        waiters: geminiWaiters
      });
      return res;
    } catch (err) {
      lastError = err;
      console.warn('[AIClient] Stage 2 (second 4 Gemini keys) all failed.');
    }
  }

  // ── Stage 3: OpenRouter API key ─────────────────────────────────────────────
  const openrouterConfig = config.aiProviders.openrouter;
  const openrouterKey = openrouterConfig?.keys?.[0];
  const openrouterModel = openrouterConfig?.defaultModel || 'minimax/minimax-m3.1-flash:free';

  if (openrouterConfig && openrouterKey) {
    console.log(`[AIClient] [Stage 3/3] Falling back to OpenRouter using model "${openrouterModel}"...`);
    try {
      const text = await sendRequestToKey(
        openrouterConfig,
        openrouterModel,
        processedMessages,
        temperature,
        maxTokens,
        { key: openrouterKey, index: 0 },
        timeoutMs
      );
      console.log('[AIClient] Stage 3 (OpenRouter) succeeded!');
      return text;
    } catch (err) {
      lastError = err;
      const status = err?.response?.status;
      const errMsg = err?.response?.data?.error?.message || err.message;
      console.error(`[AIClient] Stage 3 (OpenRouter) failed (Status: ${status}): ${errMsg}`);
    }
  } else {
    console.warn('[AIClient] Stage 3 skipped: OpenRouter API key not configured.');
  }

  throw lastError || new Error('All 3 stages of vision fallback failed.');
}

/**
 * Universal AI chat completion router.
 * Dispatches requests to the provider configured for the specific feature (or custom options).
 * Supports automatic concurrency-aware key rotation and failover.
 * Features involving vision (moderationImage, moderationMedia, imageReaction) or using gemini provider
 * follow the 3-stage fallback:
 *   Stage 1: First 4 Gemini keys (raced in parallel)
 *   Stage 2: Second 4 Gemini keys (raced in parallel)
 *   Stage 3: OpenRouter Minimax vision model
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
  const timeoutMs = overrideOptions.timeout || featureConfig.timeout || 30000;

  // Pre-process any image URLs to base64
  const processedMessages = await resolveImageUrls(messages);

  // Check if this request contains vision attachments/images or is a vision moderation feature
  const hasVisionPayload = processedMessages.some(m =>
    Array.isArray(m.content) && m.content.some(c => c?.type === 'image_url')
  );
  const isVisionFeature = ['chatVision', 'moderationImage', 'moderationMedia'].includes(featureName);

  // If attachments/images are included OR it's a vision feature, route through the 3-stage fallback:
  // Stage 1: First 4 Gemini keys (parallel race)
  // Stage 2: Second 4 Gemini keys (parallel race)
  // Stage 3: OpenRouter Minimax vision model
  if (hasVisionPayload || isVisionFeature) {
    console.log(`[AIClient] Vision payload detected for feature "${featureName}". Routing to 3-stage vision pipeline (Gemini Batch 1 -> Gemini Batch 2 -> OpenRouter)...`);
    return executeThreeStageVisionFallback({
      model: featureConfig.visionModel || 'gemini-3.1-flash-lite',
      processedMessages,
      temperature,
      maxTokens,
      timeoutMs
    });
  }

  // If Gemini text-only, run 4-key batching
  if (provider === 'gemini') {
    const geminiConfig = config.aiProviders.gemini;
    const { keyPool, waiters } = getKeyPool('gemini', geminiConfig.keys);
    const triedIndices = new Set();
    const batchKeys = [];
    const count = Math.min(4, keyPool.length);
    for (let i = 0; i < count; i++) {
      const keyObj = await acquireFreeKey('gemini', keyPool, waiters, triedIndices);
      triedIndices.add(keyObj.index);
      batchKeys.push(keyObj);
    }
    return executeBatchOfKeys({
      provider: 'gemini',
      providerConfig: geminiConfig,
      model,
      processedMessages,
      temperature,
      maxTokens,
      timeoutMs,
      batchKeys,
      waiters
    });
  }

  // Sequential failover for other providers (e.g. Groq)
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

  while (attempts < maxAttempts) {
    const keyObj = await acquireFreeKey(provider, keyPool, waiters, triedIndices);
    triedIndices.add(keyObj.index);
    attempts++;

    try {
      console.log(`[AIClient] Provider "${provider}" using key index ${keyObj.index} (attempt ${attempts}/${maxAttempts})...`);
      const text = await sendRequestToKey(
        providerConfig,
        model,
        processedMessages,
        temperature,
        maxTokens,
        keyObj,
        timeoutMs
      );

      releaseKey(keyObj, waiters);
      return text;
    } catch (err) {
      releaseKey(keyObj, waiters);
      lastError = err;

      const status = err?.response?.status;
      const errMsg = err?.response?.data?.error?.message || err.message;
      console.warn(`[AIClient] Provider "${provider}" key index ${keyObj.index} failed (Status: ${status}): ${errMsg}`);

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
