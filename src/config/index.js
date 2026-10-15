require('dotenv').config();

module.exports = {
  discord: {
    token: process.env.DISCORD_TOKEN,
    // Cabin channel where !todo commands and interactions are restricted
    cabinChannelId: process.env.CABIN_CHANNEL_ID || process.env.BONDS_CABIN_CHANNEL_ID || '1560281139921297540',
    // Optional channel to announce bot status when booting
    channelId: process.env.DISCORD_CHANNEL_ID,
    // Role IDs allowed to run admin commands (!todo working, !todo done, !todo reject, !todo delete)
    // Supports comma-separated IDs in env or defaults to Administrator / specific roles
    adminRoleIds: (process.env.TODO_ADMIN_ROLE_IDS || process.env.COMMANDER_ROLE_ID || '1558597413806284826,1448029016844931143')
      .split(',')
      .map(id => id.trim())
      .filter(Boolean),
    // Custom checkmark emoji ID or fallback unicode
    successEmoji: process.env.TODO_SUCCESS_EMOJI || '✅',
  },
  supabase: {
    url: process.env.SUPABASE_URL,
    key: process.env.SUPABASE_KEY || process.env.SUPABASE_SERVICE_KEY,
  },
  gemini: {
    apiKey: process.env.GEMINI_API_KEY || process.env.GEMINI_API_KEY_ONE,
    model: process.env.GEMINI_MODEL || 'gemini-3.1-flash-lite',
  }
};
