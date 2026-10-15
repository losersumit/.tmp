const { Events } = require('discord.js');
const config = require('../config');
const { syncServerConfig } = require('../utils/configSync');

module.exports = {
  name: Events.ClientReady,
  once: true,
  async execute(client) {
    console.log(`🤖 Logged in as ${client.user.tag}`);
    console.log(`📋 Cabin Channel: ${config.discord.cabinChannelId}`);

    // Update all roles and channels on restart
    await syncServerConfig(client);
  }
};

