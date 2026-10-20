const { Events, MessageFlags } = require('discord.js');
const { handleTodoPagination } = require('../features/todoCommands');

module.exports = {
  name: Events.InteractionCreate,
  async execute(interaction, client) {
    // ── Slash Commands ────────────────────────────────────────────────────────
    if (interaction.isChatInputCommand()) {
      const command = client.commands?.get(interaction.commandName);
      if (!command) {
        console.error(`[Interaction] No command matching /${interaction.commandName} was found.`);
        return;
      }

      try {
        await command.execute(interaction);
      } catch (error) {
        console.error(`[Interaction] Error executing /${interaction.commandName}:`, error);
        const errorReply = {
          content: 'There was an error while executing this command!',
          flags: MessageFlags.Ephemeral
        };
        if (interaction.replied || interaction.deferred) {
          await interaction.followUp(errorReply).catch(() => {});
        } else {
          await interaction.reply(errorReply).catch(() => {});
        }
      }
      return;
    }

    // ── Button Interactions ───────────────────────────────────────────────────
    if (interaction.isButton()) {
      if (interaction.customId.startsWith('todo_prev:') || interaction.customId.startsWith('todo_next:')) {
        await handleTodoPagination(interaction, client);
      }
    }
  }
};
