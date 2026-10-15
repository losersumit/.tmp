const { Events } = require('discord.js');
const config = require('../config');

module.exports = {
  name: Events.ClientReady,
  once: true,
  async execute(client) {
    console.log(`🤖 Logged in as ${client.user.tag}`);
    console.log(`📋 Cabin Channel: ${config.discord.cabinChannelId}`);

    if (config.discord.channelId) {
      try {
        const channel = await client.channels.fetch(config.discord.channelId);
        if (channel && typeof channel.send === 'function') {
          await channel.send('I am Alive');
        }
      } catch (error) {
        console.error('Unable to send startup notification:', error.message);
      }
    }
  }
};
