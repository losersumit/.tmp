const { Client, GatewayIntentBits, Partials } = require('discord.js');
const config = require('./src/config');
const readyEvent = require('./src/events/ready');
const messageCreateEvent = require('./src/events/messageCreate');
const interactionCreateEvent = require('./src/events/interactionCreate');

if (!config.discord.token) {
  throw new Error('Set DISCORD_TOKEN before starting.');
}

// Build intents based on developer portal configuration
// NOTE: "MessageContent" is a Privileged Gateway Intent.
// If you see "Used disallowed intents", ensure "Message Content Intent" is toggled ON
// in Discord Developer Portal -> Your App -> Bot -> Privileged Gateway Intents.
const intents = [
  GatewayIntentBits.Guilds,
  GatewayIntentBits.GuildMessages,
  GatewayIntentBits.GuildMessageReactions
];

if (process.env.DISCORD_ENABLE_MESSAGE_CONTENT === 'true' || process.env.DISCORD_ENABLE_MESSAGE_CONTENT === '1') {
  intents.push(GatewayIntentBits.MessageContent);
}

const client = new Client({
  intents,
  partials: [Partials.Message, Partials.Channel, Partials.Reaction]
});

// Event registrations
client.once(readyEvent.name, () => readyEvent.execute(client));
client.on(messageCreateEvent.name, (message) => messageCreateEvent.execute(message, client));
client.on(interactionCreateEvent.name, (interaction) => interactionCreateEvent.execute(interaction, client));

client.on('error', (error) => console.error('Discord client error:', error));

client.login(config.discord.token).catch((error) => {
  console.error('Discord login failed:', error);
  process.exitCode = 1;
});
