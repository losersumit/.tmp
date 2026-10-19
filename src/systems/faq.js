const axios = require('axios');
const config = require('../config');
const { supabase } = require('../database/supabase');

let warnedMissingEnv = false;

function isConfigured() {
  return Boolean(
    config.supabase.url &&
    config.supabase.key &&
    config.nomic?.apiKey
  );
}

function getThreshold() {
  return Number.parseFloat(process.env.FAQ_SIMILARITY_THRESHOLD || '0.30');
}

/**
 * Generate embedding for text or array of texts using Nomic API
 * @param {string|string[]} textOrArray
 * @param {string} inputType - 'search_document' | 'search_query'
 * @returns {Promise<number[]|number[][]|null>}
 */
async function embed(textOrArray, inputType = 'search_document') {
  if (!isConfigured()) return null;
  if (!config.nomic?.apiKey) {
    throw new Error('No Nomic API key configured.');
  }

  const texts = Array.isArray(textOrArray) ? textOrArray : [textOrArray];
  if (texts.length === 0) return Array.isArray(textOrArray) ? [] : null;

  const allEmbeddings = [];
  for (let i = 0; i < texts.length; i += 90) {
    const batch = texts.slice(i, i + 90);
    try {
      const resp = await axios.post(
        config.nomic.endpoint,
        {
          model: config.nomic.model || 'nomic-embed-text-v1.5',
          texts: batch,
          task_type: inputType,
          dimensionality: config.nomic.dimension || 768
        },
        {
          headers: {
            Authorization: `Bearer ${config.nomic.apiKey}`,
            'Content-Type': 'application/json'
          },
          timeout: 25000
        }
      );
      allEmbeddings.push(...resp.data.embeddings);
    } catch (err) {
      console.error('[Nomic API Error]', err.response?.data || err.message);
      throw err;
    }
  }

  return Array.isArray(textOrArray) ? allEmbeddings : allEmbeddings[0];
}

function toVec(raw) {
  if (!raw) return null;
  if (Array.isArray(raw)) return raw;

  if (typeof raw === 'string') {
    try {
      const p = JSON.parse(raw);
      if (Array.isArray(p)) return p;
    } catch { }
    const parts = raw.split(',').map(Number);
    if (parts.every((n) => !Number.isNaN(n))) return parts;
  }

  if (ArrayBuffer.isView(raw)) return Array.from(raw);
  if (raw.embedding && Array.isArray(raw.embedding)) return raw.embedding;
  if (raw.values && Array.isArray(raw.values)) return raw.values;

  for (const k in raw) {
    if (Array.isArray(raw[k])) return raw[k];
  }

  return null;
}

function cosine(a, b) {
  if (!a || !b || a.length !== b.length) return -1;
  let dot = 0;
  let na = 0;
  let nb = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    na += a[i] * a[i];
    nb += b[i] * b[i];
  }
  if (!na || !nb) return -1;
  return dot / (Math.sqrt(na) * Math.sqrt(nb));
}

/**
 * Searches the faqs table in Supabase for matching questions using cosine similarity.
 * @param {string} question
 * @returns {Promise<string|null>}
 */
async function findFaqAnswer(question) {
  if (!isConfigured()) {
    if (!warnedMissingEnv) {
      warnedMissingEnv = true;
      console.warn('[FAQ] FAQ lookup disabled: missing SUPABASE_URL, SUPABASE_KEY, or NOMIC_API_KEY.');
    }
    return null;
  }

  try {
    const qVec = await embed(question, 'search_query');
    if (!qVec) return null;

    const { data, error } = await supabase.from('faqs').select('title, content, embedding').limit(1000);
    if (error || !data || !Array.isArray(data)) {
      return null;
    }

    let best = null;
    for (const row of data) {
      const v = toVec(row.embedding);
      if (!v || v.length !== qVec.length) continue;

      const score = cosine(qVec, v);
      if (!best || score > best.score) best = { ...row, score };
    }

    const threshold = getThreshold();
    if (!best || best.score < threshold) return null;
    return best.content;
  } catch (err) {
    console.error('[FAQ] Lookup error:', err.message);
    return null;
  }
}

module.exports = {
  embed,
  findFaqAnswer
};
