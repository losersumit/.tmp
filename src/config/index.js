require('dotenv').config();
const roles = require('./roles');
const channels = require('./channels');

module.exports = {
  // Server IDs & Constants
  roles,
  channels,

  // Discord Bot Configurations
  discord: {
    token: process.env.DISCORD_TOKEN,
    // Restrict !todo commands to Cabin / Headquarters channel
    cabinChannelId: channels.CABIN,
    // Designated Chatbot conversation channel
    chatbotChannelId: channels.QUESTIONS || channels.TEXT?.QUESTIONS || channels.TEXT?.OUESTIONS,
    // Staff/Admin roles allowed to execute admin commands (!todo working, !todo done, !todo reject, !todo delete)
    adminRoleIds: roles.STAFF_ROLES,
    // Custom checkmark emoji ID or fallback unicode
    successEmoji: '✅',
  },

  // Database Configurations (Secrets in .env)
  supabase: {
    url: process.env.SUPABASE_URL,
    key: process.env.SUPABASE_KEY || process.env.SUPABASE_SERVICE_KEY,
  },

  // Embeddings API (Nomic)
  nomic: {
    apiKey: process.env.NOMIC_API_KEY,
    endpoint: process.env.NOMIC_ENDPOINT || 'https://api-atlas.nomic.ai/v1/embedding/text',
    model: process.env.NOMIC_MODEL || 'nomic-embed-text-v1.5',
    dimension: 768,
  },

  // AI Providers & API Keys (Secrets in .env)
  aiProviders: {
    groq: {
      keys: [
        process.env.GROQ_API_KEY_ONE,
        process.env.GROQ_API_KEY_TWO,
        process.env.GROQ_API_KEY_THREE,
        process.env.GROQ_API_KEY_FOUR,
        process.env.GROQ_API_KEY_FIVE,
        process.env.GROQ_API_KEY,
      ].filter(Boolean),
      endpoint: process.env.GROQ_ENDPOINT || 'https://api.groq.com/openai/v1/chat/completions',
    },
    gemini: {
      keys: [
        process.env.GEMINI_API_KEY_ONE,
        process.env.GEMINI_API_KEY_TWO,
        process.env.GEMINI_API_KEY_THREE,
        process.env.GEMINI_API_KEY_FOUR,
        process.env.GEMINI_API_KEY_FIVE,
        process.env.GEMINI_API_KEY_SIX,
        process.env.GEMINI_API_KEY_SEVEN,
        process.env.GEMINI_API_KEY_EIGHT,
        process.env.GEMINI_API_KEY,
      ].filter(Boolean),
      endpoint: process.env.GEMINI_ENDPOINT || 'https://generativelanguage.googleapis.com/v1beta/openai/v1/chat/completions',
    }
  },

  // =========================================================================
  // Feature-Specific AI Routing Config
  // -------------------------------------------------------------------------
  // Change provider or model here to switch between models for any feature.
  // Supported providers: 'groq' | 'gemini'
  // =========================================================================
  features: {
    todo: {
      provider: process.env.TODO_AI_PROVIDER || 'groq',
      model: process.env.TODO_AI_MODEL || 'openai/gpt-oss-120b',
      temperature: 0.1,
      maxTokens: 300
    },
    welcome: {
      provider: process.env.WELCOME_AI_PROVIDER || 'groq',
      model: process.env.WELCOME_AI_MODEL || 'openai/gpt-oss-120b',
      temperature: 0.7,
      maxTokens: 500
    },
    chat: {
      provider: process.env.CHAT_AI_PROVIDER || 'groq',
      model: process.env.CHAT_AI_MODEL || 'openai/gpt-oss-120b',
      visionModel: process.env.CHAT_VISION_MODEL || 'gemini-3.1-flash-lite',
      temperature: Number(process.env.CHAT_TEMPERATURE || 0.6),
      maxTokens: Number(process.env.CHAT_MAX_TOKENS || 512)
    },
    imageReaction: {
      provider: process.env.IMAGE_REACTION_AI_PROVIDER || 'gemini',
      model: process.env.IMAGE_REACTION_AI_MODEL || 'gemini-3.1-flash-lite',
      temperature: 0.1,
      maxTokens: 30
    },
    ragSummary: {
      provider: process.env.RAG_SUMMARY_AI_PROVIDER || 'groq',
      model: process.env.RAG_SUMMARY_AI_MODEL || 'openai/gpt-oss-120b',
      temperature: 0.2,
      maxTokens: 300
    },

    // ── AI Moderation Features ──────────────────────────────────────────────
    // Chat/text moderation → Groq (fast, text-only)
    moderationText: {
      provider: process.env.MODERATION_TEXT_AI_PROVIDER || 'groq',
      model: process.env.MODERATION_TEXT_AI_MODEL || 'openai/gpt-oss-20b',
      temperature: 0.1,
      maxTokens: 500
    },
    // Image moderation → Gemini (vision-capable)
    moderationImage: {
      provider: process.env.MODERATION_IMAGE_AI_PROVIDER || 'gemini',
      model: process.env.MODERATION_IMAGE_AI_MODEL || 'gemini-3.1-flash-lite',
      temperature: 0.1,
      maxTokens: 500
    },
    // GIF / video frame moderation → Gemini (multi-image vision)
    moderationMedia: {
      provider: process.env.MODERATION_MEDIA_AI_PROVIDER || 'gemini',
      model: process.env.MODERATION_MEDIA_AI_MODEL || 'gemini-3.1-flash-lite',
      temperature: 0.1,
      maxTokens: 500,
      timeout: 90000  // 90s — multi-image payloads need extra time on Gemini
    }
  },

  // =========================================================================
  // AI Moderation Settings
  // =========================================================================
  moderation: {
    // Flag borderline content even when AI is not fully certain
    strictMode: false,

    // Minimum character count — very short messages are skipped
    minMessageLength: 2,

    // Sensitivity multiplier shown to the AI (0–1, displayed as x10 score)
    sensitivity: 0.1,

    // Channels where moderation is completely skipped (IDs from channels.js)
    ignoredChannels: [
      channels.TEXT?.BOT_COMMANDS || channels.TEXT?.BOT_CMDS,
      channels.TEXT?.STAFFS_ONLY,
      channels.TEXT?.MAJOR_VTCS,
      channels.TEXT?.MINOR_VTCS, 
    ],

    // Categories where moderation is completely skipped (all channels within these categories)
    ignoredCategories: [
      channels.CATEGORIES?.VTCS || '1560352413146284052',
    ],

    // Channels restricted to images only (text messages without images are deleted)
    imageOnlyChannels: [
      channels.TEXT.FLEET_SHOWCASE,
    ],

    // Roles that bypass moderation entirely — empty means everyone is moderated
    ignoredRoles: [],

    // Warning count → automated action thresholds
    warnings: {
      actionThresholds: {
        timeout1h:  3,   // 3 warnings  → 1-hour timeout
        timeout24h: 5,   // 5 warnings  → 24-hour timeout
        kick:       7,   // 7 warnings  → kick
        ban:        10   // 10 warnings → ban
      }
    },

    // Permissions: Role authorized to clear warnings (!cw)
    partnerRoleId: roles.PARTNER,

    // Mod-log channel lookup — checked in order until one is found
    logging: {
      // Primary designated logging channel ID from channels config
      logChannelId: channels.TEXT?.AI_MOD_LOGS,
      modLogChannels: ['ai-mod-logs', 'aimodlogs', 'mod-logs', 'modlogs', 'mod-log', 'modlog', 'bot-logs', 'admin-logs'],
      consoleLog: true,
      includeMessageContent: true,
      censorMessageContent: false,
      maxContentLength: 1024
    },

    // Embed color scheme and notification behaviour
    appearance: {
      colors: {
        error:          '#FF0000',
        warning:        '#FF9900',
        info:           '#0099FF',
        success:        '#00CC66',
        lowSeverity:    '#FFCC00',
        mediumSeverity: '#FF6600',
        highSeverity:   '#FF0000'
      },
      showUserAvatarsInLogs: true,
      // If DMs are closed, post a brief channel notice instead
      sendChannelNotificationsWhenDMFails: true,
      channelNotificationTimeout: 5000 // ms before the channel notice is auto-deleted
    }
  }
};
