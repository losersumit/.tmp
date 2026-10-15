const axios = require('axios');
const config = require('../config');

/**
 * Summarizes raw task description into a short 4-5 word title using Gemini
 * Falls back gracefully to text truncation if no API key is configured or on error.
 * @param {string} taskText 
 * @returns {Promise<string>}
 */
async function generateTaskTitle(taskText) {
  if (!taskText) return '';
  const fallback = taskText.substring(0, 40);

  const apiKey = config.gemini.apiKey;
  if (!apiKey) {
    return fallback;
  }

  try {
    const aiPrompt = `Translate the following task into a very short, concise title (maximum 4-5 words) summarizing it. Return ONLY the title, no extra text, no markdown, no quotes.\n\nTask: ${taskText}`;
    const endpoint = `https://generativelanguage.googleapis.com/v1beta/openai/v1/chat/completions`;

    const res = await axios.post(
      endpoint,
      {
        model: config.gemini.model,
        messages: [{ role: 'user', content: aiPrompt }],
        temperature: 0.1,
        max_tokens: 30
      },
      {
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${apiKey}`
        },
        timeout: 10000
      }
    );

    const generatedTitle = res.data?.choices?.[0]?.message?.content?.trim();
    if (generatedTitle) {
      return generatedTitle.replace(/^["']|["']$/g, '');
    }
  } catch (err) {
    console.error('Error in generateTaskTitle (falling back):', err?.response?.data || err.message);
  }

  return fallback;
}

module.exports = {
  generateTaskTitle
};
