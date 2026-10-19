const { Events } = require('discord.js');
const config = require('../config');
const { getChatCompletionForFeature } = require('../utils/aiUtils');

// Welcome settings for Truckers MP - eClub.
const WELCOME_CHANNEL_ID = config.channels.TEXT.CHAT;

function fallbackIntro(displayName) {
  return `${displayName} just landed in the server.`;
}

async function createWelcomeIntro(member) {
  const displayName = member.displayName || member.user.globalName || member.user.username;

  try {
    const response = await getChatCompletionForFeature('welcome', [
      {
        role: 'system',
        content: [
          'You write short, fun, creative arrival announcements for new Discord members in a trucking community.',
          'Output exactly ONE sentence using the member\'s display name.',
          'Make it fresh and playful — vary the style every time.',
          'Examples: "BonD just landed in the server." / "BonD brought us all pizza." / "BonD accidentally showed up." / "BonD joined the family." / "BonD rolled in out of nowhere." / "BonD took a wrong turn and ended up here."',
          'Do NOT use emojis, quotes, markdown, @mentions, or the word "community".',
          'Return ONLY the single sentence, nothing else.',
        ].join(' ')
      },
      {
        role: 'user',
        content: `Write the arrival announcement for: ${displayName}`
      }
    ]);

    const cleaned = String(response || '')
      .replace(/<@&?\d+>/g, '')
      .replace(/@everyone|@here/gi, '')
      .replace(/^["'`]+|["'`]+$/g, '')
      .trim();

    // Must be a single short sentence, no prompt leakage.
    const looksLikePromptLeak = /you write|output exactly|make it fresh|examples?:|return only|display name|system prompt/i.test(cleaned);

    if (cleaned && !looksLikePromptLeak && cleaned.length <= 120) {
      return cleaned;
    }

    console.warn('[Welcome] AI returned invalid intro; using fallback.');
  } catch (error) {
    console.error('[Welcome] AI intro failed; using fallback:', error.message);
  }

  return fallbackIntro(displayName);
}

module.exports = {
  name: Events.GuildMemberAdd,
  async execute(member) {
    // 1. Auto-assign the SNOW_USER role from config.roles
    if (config.roles?.SNOW_USER) {
      try {
        await member.roles.add(config.roles.SNOW_USER);
        console.log(`[AutoRole] Assigned SNOW_USER role (${config.roles.SNOW_USER}) to ${member.user.tag} (${member.id}).`);
      } catch (roleError) {
        console.error(`[AutoRole] Failed to assign SNOW_USER role to ${member.user.tag}:`, roleError.message);
      }
    }

    // 2. Send welcome announcement
    try {
      const channel = await member.guild.channels.fetch(WELCOME_CHANNEL_ID).catch(() => null);

      if (!channel || !channel.isTextBased() || !channel.send) {
        console.warn(`[Welcome] Welcome channel ${WELCOME_CHANNEL_ID} was not found or is not a text channel.`);
        return;
      }

      const intro = await createWelcomeIntro(member);

      await channel.send({
        content: `<@${member.id}> ${intro} Say Hi to them!`,
        allowedMentions: { users: [member.id] }
      });

      console.log(`[Welcome] Welcomed ${member.user.tag} (${member.id}) in #${channel.name}.`);
    } catch (error) {
      console.error('[Welcome] Failed to send welcome message:', error);
    }
  }
};
