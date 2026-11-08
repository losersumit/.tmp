const { Events, REST, Routes } = require('discord.js');
const config = require('../config');
const { syncServerConfig } = require('../utils/configSync');
const { scheduleRagHourlySummaries } = require('../features/ragChat');
const {
  ensureAllApprovedGuildRolesExist,
  listenToApprovedGuilds,
  scheduleDailyVtcSync
} = require('../features/vtcSync');
const { commands } = require('../commands');

module.exports = {
  name: Events.ClientReady,
  once: true,
  async execute(client) {
    console.log(`🤖 Logged in as ${client.user.tag}`);
    console.log(`📋 Cabin Channel: ${config.discord.cabinChannelId}`);

    // Update all roles and channels on restart
    await syncServerConfig(client);

    // Verify all approved guild roles exist and create any missing ones above VTC Drivers
    await ensureAllApprovedGuildRolesExist(client);

    // Start Realtime listener for newly added approved guilds
    listenToApprovedGuilds(client);

    // Schedule daily 12:00 AM GMT member VTC sync
    scheduleDailyVtcSync(client);

    // Register slash commands across guilds or globally
    try {
      console.log('🔄 Registering application (/) commands...');
      const commandsData = commands.map(cmd => cmd.data.toJSON());
      const rest = new REST({ version: '10' }).setToken(config.discord.token);

      // Deploy commands to all guilds the bot is currently in
      await Promise.all(client.guilds.cache.map(async (guild) => {
        try {
          await rest.put(
            Routes.applicationGuildCommands(client.user.id, guild.id),
            { body: commandsData }
          );
          console.log(`✅ Registered slash commands in guild: ${guild.name} (${guild.id})`);
        } catch (err) {
          console.error(`❌ Failed to register slash commands in guild ${guild.name}:`, err.message);
        }
      }));
    } catch (cmdErr) {
      console.error('❌ Error deploying application commands:', cmdErr);
    }

    // Schedule hourly RAG summaries for chat context
    scheduleRagHourlySummaries(client);
  }
};
