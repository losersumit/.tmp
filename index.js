require('dotenv').config();
const { Client, GatewayIntentBits } = require('discord.js');

const token = process.env.DISCORD_TOKEN;
const channelId = process.env.DISCORD_CHANNEL_ID;

if (!token) {
	throw new Error('Set DISCORD_TOKEN before starting.');
}

const client = new Client({ intents: [GatewayIntentBits.Guilds] });

client.once('ready', async () => {
	console.log(`Logged in as ${client.user.tag}! Bot is ready.`);
	if (channelId) {
		try {
			const channel = await client.channels.fetch(channelId);
			if (!channel || typeof channel.send !== 'function') {
				throw new Error('Configured channel cannot receive messages.');
			}
			await channel.send('I am Alive');
		} catch (error) {
			console.error('Unable to send message:', error);
		}
	} else {
		console.log('DISCORD_CHANNEL_ID is not set in .env; skipping announcement message.');
	}
});

client.on('error', (error) => console.error('Discord client error:', error));
client.login(token).catch((error) => {
	console.error('Discord login failed:', error);
	process.exitCode = 1;
});
