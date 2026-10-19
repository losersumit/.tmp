const { Events } = require('discord.js');
const { handleTodoCommand } = require('../features/todoCommands');
const { handleRagChat } = require('../features/ragChat');

module.exports = {
  name: Events.MessageCreate,
  async execute(message, client) {
    if (message.author.bot) return;

    // Handle prefix commands
    if (message.content.startsWith('!')) {
      const args = message.content.slice(1).trim().split(/\s+/);
      const commandName = args.shift()?.toLowerCase();

      if (commandName === 'todo') {
        console.log(`[Command] !todo executed by ${message.author.tag} in channel ${message.channelId}`);
        await handleTodoCommand(message, args, client);
        return;
      }
    }

    // Chatbot and RAG Message Handler
    await handleRagChat(message, client);
  }
};
