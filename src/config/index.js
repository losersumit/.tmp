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

  // AI Providers & API Keys (Secrets in .env)
  aiProviders: {
    groq: {
      keys: [
        process.env.GROQ_API_KEY_ONE,
        process.env.GROQ_API_KEY_TWO,
        process.env.GROQ_API_KEY,
      ].filter(Boolean),
      endpoint: process.env.GROQ_ENDPOINT || 'https://api.groq.com/openai/v1/chat/completions',
    },
    gemini: {
      keys: [
        process.env.GEMINI_API_KEY,
        process.env.GEMINI_API_KEY_ONE,
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
      provider: 'groq',
      model: 'openai/gpt-oss-120b',
      temperature: 0.1,
      maxTokens: 300
    },
    welcome: {
      provider: 'groq',
      model: 'openai/gpt-oss-120b',
      temperature: 0.7,
      maxTokens: 140
    }
  }
};
