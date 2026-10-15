const { Events } = require('discord.js');
const { handleTodoPagination } = require('../features/todoCommands');

module.exports = {
  name: Events.InteractionCreate,
  async execute(interaction, client) {
    if (interaction.isButton()) {
      if (interaction.customId.startsWith('todo_prev:') || interaction.customId.startsWith('todo_next:')) {
        await handleTodoPagination(interaction, client);
      }
    }
  }
};
