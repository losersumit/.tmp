const { Client, GatewayIntentBits, Partials } = require('discord.js');
const config = require('./src/config');
const readyEvent = require('./src/events/ready');
const messageCreateEvent = require('./src/events/messageCreate');
const messageUpdateEvent = require('./src/events/messageUpdate');
const interactionCreateEvent = require('./src/events/interactionCreate');
const guildMemberAddEvent = require('./src/events/guildMemberAdd');

if (!config.discord.token) {
  throw new Error('Set DISCORD_TOKEN before starting.');
}

// Build intents based on developer portal configuration
// NOTE: "MessageContent" is a Privileged Gateway Intent — REQUIRED for moderation
// to read message.content and detect Tenor GIF URLs. Ensure it is toggled ON in:
// Discord Developer Portal → Your App → Bot → Privileged Gateway Intents.
const intents = [
  GatewayIntentBits.Guilds,
  GatewayIntentBits.GuildMembers,
  GatewayIntentBits.GuildMessages,
  GatewayIntentBits.GuildMessageReactions,
  GatewayIntentBits.MessageContent   // Required: read message.content for URL/GIF scanning
];

const client = new Client({
  intents,
  partials: [Partials.Message, Partials.Channel, Partials.Reaction]
});

// Event registrations
client.once(readyEvent.name, () => readyEvent.execute(client));
client.on(messageCreateEvent.name, (message) => messageCreateEvent.execute(message, client));
client.on(messageUpdateEvent.name, (oldMsg, newMsg) => messageUpdateEvent.execute(oldMsg, newMsg));
client.on(interactionCreateEvent.name, (interaction) => interactionCreateEvent.execute(interaction, client));
client.on(guildMemberAddEvent.name, (member) => guildMemberAddEvent.execute(member));

client.on('error', (error) => console.error('Discord client error:', error));

client.login(config.discord.token).catch((error) => {
  console.error('Discord login failed:', error);
  process.exitCode = 1;
});
