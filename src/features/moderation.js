/**
 * AI Moderation Engine
 *
 * Provides three moderation functions:
 *  - moderateMessage(content)       → Groq openai/gpt-oss-20b
 *  - moderateImage(imageUrl)        → Gemini gemini-3.1-flash-lite
 *  - moderateGifVideo(url, ext)     → Gemini gemini-3.1-flash-lite (via 5 extracted frames)
 *
 * All AI calls route through getChatCompletionForFeature() per AGENTS.md rules.
 */

const { getChatCompletionForFeature } = require('../utils/aiUtils');
const { extractFramesFromMedia } = require('./gifFrameExtractor');
const config = require('../config');

const { strictMode, sensitivity, minMessageLength } = config.moderation;

// ─── Shared Prompt Builders ────────────────────────────────────────────────────

function buildTextPrompt(messageContent) {
  return `
You are a content moderator for a Discord server. Your task is to detect inappropriate content.
The moderation sensitivity level is set to: ${sensitivity * 10}/10 (where 10 is extremely strict).

Analyze the following message and determine if it contains any of these categories:
- Explicit sexual content
- NSFW Content
- Spam, scams, or malicious links (e.g. discord.gg/ invite links) + Mr Beast Scam 
- N word "nigga", this could be written in any form like "nga" or nigg@, make sure to decode and flag all type of references. 

Message to analyze: "${messageContent}"

Respond in JSON format ONLY (no markdown, no code fences):
{
  "isFlagged": true/false,
  "reason": "brief description of violation if flagged, empty string if not",
  "severity": "low/medium/high/none",
  "categories": ["list of violated categories if any"],
  "confidence": 0.0
}

Only flag content that falls in the above categories. When in doubt, do not flag.
Strict mode is currently: ${strictMode ? 'ENABLED' : 'DISABLED'}.
`.trim();
}

function buildImagePrompt() {
  return `
You are a content moderator for a Discord server. Analyze this image for inappropriate content.

Check for:
- Explicit sexual content, nudity, or pornography
- Excessive gore
- Mr Beast Twitter/X screenshot scams (flag these — they are known scams)

Respond in JSON format ONLY (no markdown, no code fences):
{
  "isFlagged": true/false,
  "reason": "brief description of violation if flagged, empty string if not",
  "severity": "low/medium/high/none",
  "categories": ["list of violated categories if any"],
  "confidence": 0.0
}

Only flag content that falls in the above categories.
`.trim();
}

function buildFramesPrompt(frameCount) {
  return `
You are a content moderator for a Discord server. You are reviewing ${frameCount} frames extracted from a GIF or video.

These frames are evenly sampled across the full duration of the media. Analyze ALL frames together and determine if the media contains:
- Explicit sexual content, nudity, or pornography
- Excessive gore, blood

Respond in JSON format ONLY (no markdown, no code fences):
{
  "isFlagged": true/false,
  "reason": "brief description of violation if flagged, empty string if not",
  "severity": "low/medium/high/none",
  "categories": ["list of violated categories if any"],
  "confidence": 0.0
}

Only flag content that falls in the above categories.
`.trim();
}

// ─── Result Parser ─────────────────────────────────────────────────────────────

/**
 * Parse and validate the AI's JSON moderation response string.
 * Applies strict mode escalation if configured.
 *
 * @param {string} responseText
 * @param {string} context - For logging ('text', 'image', 'gif/video')
 * @returns {{ isFlagged: boolean, reason: string, severity: string, categories: string[], confidence: number }}
 */
function parseAndApplyStrictMode(responseText, context) {
  let result;
  try {
    // Strip any accidental markdown code fences
    const cleaned = responseText.replace(/```(?:json)?/gi, '').trim();
    result = JSON.parse(cleaned);
  } catch (err) {
    console.error(`[Moderation] Failed to parse AI JSON response for ${context}:`, responseText.substring(0, 200));
    return { isFlagged: false, reason: '', severity: 'none', categories: [], confidence: 0 };
  }

  let shouldFlag = Boolean(result.isFlagged);

  // Strict mode: escalate if AI is on the fence
  if (!shouldFlag && strictMode && result.confidence > 0.4) {
    shouldFlag = true;
    result.reason = `[Strict mode] ${result.reason || 'Potentially inappropriate content'}`;
  }

  return {
    isFlagged: shouldFlag,
    reason: result.reason || (shouldFlag ? 'Inappropriate content' : ''),
    severity: result.severity || (shouldFlag ? 'medium' : 'none'),
    categories: result.categories || [],
    confidence: result.confidence || 0
  };
}

// ─── Public Moderation Functions ───────────────────────────────────────────────

/**
 * Moderate a text message using Groq (openai/gpt-oss-20b).
 *
 * @param {string} messageContent
 * @returns {Promise<{ isFlagged: boolean, reason: string, severity: string, categories: string[], confidence: number }>}
 */
async function moderateMessage(messageContent) {
  if (!messageContent || messageContent.trim().length < minMessageLength) {
    return { isFlagged: false, reason: '', severity: 'none', categories: [], confidence: 0 };
  }

  try {
    const prompt = buildTextPrompt(messageContent);

    const responseText = await getChatCompletionForFeature('moderationText', [
      { role: 'user', content: prompt }
    ]);

    const result = parseAndApplyStrictMode(responseText, 'text');
    console.log(`[Moderation] Text check — Flagged: ${result.isFlagged}${result.isFlagged ? ` | Reason: ${result.reason}` : ''}`);
    return result;
  } catch (err) {
    console.error('[Moderation] Error in moderateMessage:', err.message);
    return { isFlagged: false, reason: '', severity: 'none', categories: [], confidence: 0 };
  }
}

/**
 * Moderate a single image using Gemini (gemini-3.1-flash-lite).
 *
 * @param {string} imageUrl - Direct CDN image URL (will be resolved to base64 by aiUtils)
 * @returns {Promise<{ isFlagged: boolean, reason: string, severity: string, categories: string[], confidence: number }>}
 */
async function moderateImage(imageUrl) {
  console.log(`[Moderation] Starting image moderation for: ${imageUrl.substring(0, 80)}...`);
  try {
    const prompt = buildImagePrompt();

    const responseText = await getChatCompletionForFeature('moderationImage', [
      {
        role: 'user',
        content: [
          { type: 'text', text: prompt },
          { type: 'image_url', image_url: { url: imageUrl } }
        ]
      }
    ]);

    const result = parseAndApplyStrictMode(responseText, 'image');
    console.log(`[Moderation] Image check — Flagged: ${result.isFlagged}${result.isFlagged ? ` | Reason: ${result.reason}` : ''}`);
    return result;
  } catch (err) {
    console.error('[Moderation] Error in moderateImage:', err.message);
    return { isFlagged: false, reason: '', severity: 'none', categories: [], confidence: 0 };
  }
}

/**
 * Moderate a GIF or video by extracting 5 frames and sending them all to Gemini.
 *
 * @param {string} attachmentUrl - Discord CDN or Tenor URL
 * @param {'gif'|'mp4'|'webm'|'mov'} ext - File extension hint
 * @returns {Promise<{ isFlagged: boolean, reason: string, severity: string, categories: string[], confidence: number }>}
 */
async function moderateGifVideo(attachmentUrl, ext = 'gif') {
  console.log(`[Moderation] Starting GIF/video moderation for: ${attachmentUrl.substring(0, 80)}...`);
  try {
    const base64Frames = await extractFramesFromMedia(attachmentUrl, ext);

    if (base64Frames.length === 0) {
      console.warn('[Moderation] No frames extracted — skipping GIF/video moderation.');
      return { isFlagged: false, reason: '', severity: 'none', categories: [], confidence: 0 };
    }

    console.log(`[Moderation] Sending ${base64Frames.length} frames to Gemini for review...`);

    const prompt = buildFramesPrompt(base64Frames.length);

    // Build vision content: text prompt + all frames as image_url entries
    const content = [
      { type: 'text', text: prompt },
      ...base64Frames.map(dataUri => ({
        type: 'image_url',
        image_url: { url: dataUri }
      }))
    ];

    const responseText = await getChatCompletionForFeature('moderationMedia', [
      { role: 'user', content }
    ]);

    const result = parseAndApplyStrictMode(responseText, 'gif/video');
    console.log(`[Moderation] GIF/video check — Flagged: ${result.isFlagged}${result.isFlagged ? ` | Reason: ${result.reason}` : ''}`);
    return result;
  } catch (err) {
    console.error('[Moderation] Error in moderateGifVideo:', err.message);
    return { isFlagged: false, reason: '', severity: 'none', categories: [], confidence: 0 };
  }
}

module.exports = { moderateMessage, moderateImage, moderateGifVideo };
