/**
 * GIF & Video Frame Extractor for AI Moderation
 *
 * Extracts 3 evenly-spaced frames from a GIF or video file using FFmpeg.
 * Frames are sampled at: t_i = ((i + 0.5) * D) / 3  for i = 0..2
 * This spreads samples across the full duration, not just the first few seconds.
 *
 * Also handles resolving Tenor/embed URLs to real CDN binary URLs.
 */

const { execFile } = require('child_process');
const { promisify } = require('util');
const fs = require('fs/promises');
const path = require('path');
const os = require('os');
const axios = require('axios');
const ffmpegPath = require('ffmpeg-static');

const execFileAsync = promisify(execFile);

/**
 * Resolve a Discord attachment or embed URL to an actual binary media CDN URL.
 * - Direct Discord CDN URLs (cdn.discordapp.com) are returned as-is.
 * - Tenor share page URLs (tenor.com/view/...) are resolved via og:url meta tag.
 * - Other URLs are returned as-is and let FFmpeg handle them.
 *
 * @param {string} url - The URL to resolve
 * @returns {Promise<string>} The resolved direct media URL
 */
async function resolveMediaUrl(url) {
  // Direct Discord CDN — already a binary URL
  if (url.includes('cdn.discordapp.com') || url.includes('media.discordapp.net')) {
    console.log(`[GifExtractor] Direct Discord CDN URL, no resolution needed.`);
    return url;
  }

  // Tenor share page — extract real GIF URL from og:url or og:image meta
  if (url.includes('tenor.com')) {
    try {
      console.log(`[GifExtractor] Resolving Tenor URL: ${url}`);
      const res = await axios.get(url, {
        timeout: 10000,
        headers: { 'User-Agent': 'Mozilla/5.0' }
      });
      const html = res.data;

      // Try og:url first (direct .gif or .mp4), then og:image (thumbnail)
      const ogUrlMatch = html.match(/<meta\s+(?:property|name)="og:url"\s+content="([^"]+)"/i);
      const ogImageMatch = html.match(/<meta\s+(?:property|name)="og:image"\s+content="([^"]+)"/i);
      // Tenor also has a media.tenor.com URL embedded in the page JSON
      const tenorMediaMatch = html.match(/https:\/\/media\.tenor\.com\/[^"'\s]+\.(?:gif|mp4)/i);

      const resolved = tenorMediaMatch?.[0] || ogUrlMatch?.[1] || ogImageMatch?.[1];
      if (resolved) {
        console.log(`[GifExtractor] Resolved Tenor URL to: ${resolved}`);
        return resolved;
      }
    } catch (err) {
      console.error(`[GifExtractor] Failed to resolve Tenor URL: ${err.message}`);
    }
    // Fall through — let FFmpeg try to handle it directly
  }

  return url;
}

/**
 * Download a remote media URL into a temp file and return the file path.
 *
 * @param {string} url
 * @param {string} ext - File extension e.g. 'gif', 'mp4'
 * @returns {Promise<string>} Path to the downloaded temp file
 */
async function downloadToTempFile(url, ext = 'gif') {
  const tmpDir = os.tmpdir();
  const tmpFile = path.join(tmpDir, `mod_media_${Date.now()}_${Math.random().toString(36).slice(2)}.${ext}`);

  const res = await axios.get(url, {
    responseType: 'arraybuffer',
    timeout: 20000,
    headers: { 'User-Agent': 'Mozilla/5.0' }
  });

  await fs.writeFile(tmpFile, Buffer.from(res.data));
  console.log(`[GifExtractor] Downloaded media to temp file: ${tmpFile}`);
  return tmpFile;
}

/**
 * Get the duration of a media file in seconds using ffmpeg's probe mode.
 * FFmpeg always writes stream/format info to stderr when given just -i.
 * Falls back to 4s if parsing fails (shorter than 5s to avoid out-of-bounds frames).
 *
 * @param {string} filePath
 * @returns {Promise<number>}
 */
async function getMediaDuration(filePath) {
  try {
    // ffmpeg exits non-zero with just -i (no output file), but still writes info to stderr
    const result = await execFileAsync(ffmpegPath, ['-v', 'error', '-i', filePath], {
      timeout: 10000
    }).catch(err => ({ stderr: err.stderr || '' }));

    const stderr = result.stderr || '';
    // Parse "Duration: HH:MM:SS.ms" from ffmpeg stderr
    const match = stderr.match(/Duration:\s*(\d+):(\d+):([\d.]+)/);
    if (match) {
      const duration = parseInt(match[1]) * 3600 + parseInt(match[2]) * 60 + parseFloat(match[3]);
      if (Number.isFinite(duration) && duration > 0) {
        return duration;
      }
    }
    console.warn(`[GifExtractor] Could not parse duration from ffmpeg output, defaulting to 4s.`);
    return 4;
  } catch (err) {
    console.warn(`[GifExtractor] ffmpeg probe failed (${err.message}), defaulting to 4s duration.`);
    return 4;
  }
}

/**
 * Extract exactly 3 frames evenly spread across the media duration.
 * Sampling formula: t_i = ((i + 0.5) * D) / 3  for i = 0, 1, 2
 * Timestamps are clamped to (duration - 0.1) to prevent out-of-bounds seeks.
 * Frames are saved as JPEG at 256px wide (much smaller payload than PNG at 512px).
 *
 * @param {string} mediaPath - Path to the media file
 * @param {string} outputDir - Directory to save extracted JPEG frames
 * @returns {Promise<string[]>} Array of up to 3 frame file paths
 */
async function extractFrames(mediaPath, outputDir) {
  await fs.mkdir(outputDir, { recursive: true });

  const duration = await getMediaDuration(mediaPath);
  console.log(`[GifExtractor] Media duration: ${duration.toFixed(2)}s. Extracting 3 frames...`);

  const frames = [];
  const FRAME_COUNT = 3;

  for (let i = 0; i < FRAME_COUNT; i++) {
    // Sample the middle of each of 3 equal-duration segments, clamped to avoid EOF
    const rawTimestamp = ((i + 0.5) * duration) / FRAME_COUNT;
    const timestamp = Math.min(rawTimestamp, duration - 0.1);
    const outputPath = path.join(outputDir, `frame_${i + 1}.jpg`);

    try {
      await execFileAsync(ffmpegPath, [
        '-y',
        '-ss', timestamp.toFixed(3),
        '-i', mediaPath,
        '-frames:v', '1',
        '-vf', 'scale=256:-1',  // 256px wide JPEG — ~10-40KB each vs ~200KB+ for 512px PNG
        '-q:v', '5',            // JPEG quality (2=best, 31=worst; 5 is a good balance)
        outputPath
      ]);
      frames.push(outputPath);
      console.log(`[GifExtractor] Extracted frame ${i + 1}/${FRAME_COUNT} at t=${timestamp.toFixed(2)}s`);
    } catch (err) {
      console.warn(`[GifExtractor] Failed to extract frame ${i + 1} at t=${timestamp.toFixed(2)}s: ${err.message}`);
    }
  }

  return frames;
}

/**
 * Read a list of frame JPEG files and return them as base64 data URIs.
 *
 * @param {string[]} framePaths
 * @returns {Promise<string[]>} Base64 data URIs
 */
async function framesToBase64(framePaths) {
  const uris = [];
  for (const framePath of framePaths) {
    try {
      const data = await fs.readFile(framePath);
      uris.push(`data:image/jpeg;base64,${data.toString('base64')}`);
    } catch (err) {
      console.warn(`[GifExtractor] Could not read frame file ${framePath}: ${err.message}`);
    }
  }
  return uris;
}

/**
 * Clean up temporary files and directories.
 *
 * @param {string[]} framePaths
 * @param {string} mediaPath
 * @param {string} frameDir
 */
async function cleanup(framePaths, mediaPath, frameDir) {
  for (const f of framePaths) {
    await fs.rm(f, { force: true });
  }
  await fs.rm(frameDir, { recursive: true, force: true });
  await fs.rm(mediaPath, { force: true });
}

/**
 * Full pipeline: resolve URL → download → extract 3 JPEG frames → return base64 URIs.
 * Cleans up all temp files after extraction.
 *
 * @param {string} attachmentUrl - The Discord attachment or Tenor URL
 * @param {'gif'|'mp4'|'webm'|'mov'} ext - File extension hint
 * @returns {Promise<string[]>} Up to 3 base64 JPEG data URIs for moderation
 */
async function extractFramesFromMedia(attachmentUrl, ext = 'gif') {
  const resolvedUrl = await resolveMediaUrl(attachmentUrl);

  const tmpDir = os.tmpdir();
  const frameDir = path.join(tmpDir, `mod_frames_${Date.now()}`);
  let mediaPath = null;

  try {
    mediaPath = await downloadToTempFile(resolvedUrl, ext);
    const framePaths = await extractFrames(mediaPath, frameDir);

    if (framePaths.length === 0) {
      console.warn(`[GifExtractor] No frames extracted from: ${resolvedUrl}`);
      return [];
    }

    const base64Frames = await framesToBase64(framePaths);
    await cleanup(framePaths, mediaPath, frameDir);
    return base64Frames;
  } catch (err) {
    console.error(`[GifExtractor] Pipeline failed for ${attachmentUrl}: ${err.message}`);
    // Best-effort cleanup
    if (mediaPath) await fs.rm(mediaPath, { force: true }).catch(() => {});
    await fs.rm(frameDir, { recursive: true, force: true }).catch(() => {});
    return [];
  }
}


module.exports = { extractFramesFromMedia, resolveMediaUrl };
