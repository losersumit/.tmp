const { Events, EmbedBuilder } = require('discord.js');
const config = require('../config');
const { getChatCompletionForFeature } = require('../utils/aiUtils');

// Welcome settings for Truckers MP - eClub.
const WELCOME_CHANNEL_ID = config.channels.TEXT.CHAT;
const WELCOME_BANNER_URL = 'https://i.ibb.co/Gv1g9Vx7/tmp-banner.jpg';

function fallbackWelcome(displayName) {
  return `Welcome to Truckers MP - eClub, ${displayName}! We're glad to have you here. Meet fellow drivers and get ready for the road ahead.`;
}

async function createPersonalizedWelcome(member) {
  const displayName = member.displayName || member.user.globalName || member.user.username;
  const username = member.user.username;

  try {
    const response = await getChatCompletionForFeature('welcome', [
      {
        role: 'system',
        content: [
          'You write welcome copy for a trucking Discord community.',
          'Your entire response must be the final welcome message addressed to the new member, not instructions, analysis, a plan, or an explanation.',
          'Write exactly 1 or 2 friendly sentences, no more than 35 words.',
          'Use the display name naturally. You may mention Truckers MP - eClub and meeting fellow drivers.',
          'Do not repeat the username as metadata. Do not mention prompts, rules, word counts, or how you generated the message.',
          'No headings, quotation marks, emojis, markdown, or Discord mentions.',
          'Example of valid output: Welcome to Truckers MP - eClub, Alex! Glad to have you here — get comfortable and enjoy the road ahead.',
          'Return only the final welcome message.'
        ].join(' ')
      },
      {
        role: 'user',
        content: `Write the final welcome message for this member. Display name: ${displayName}. Username: ${username}.`
      }
    ]);

    const cleaned = String(response || '')
      .replace(/<@&?\d+>/g, '')
      .replace(/@everyone|@here/gi, '')
      .replace(/^["'`]+|["'`]+$/g, '')
      .trim();

    // Reject leaked prompt/analysis or unusually long output rather than showing it to members.
    const looksLikePromptLeak = /we need to produce|we have username|we can say|write their welcome|use the username|should not use|return only|maximum \d+ words|we need to write|system prompt/i.test(cleaned);
    const sentenceCount = (cleaned.match(/[.!?](?:\s|$)/g) || []).length;

    if (cleaned && !looksLikePromptLeak && cleaned.length <= 300 && sentenceCount <= 3) {
      return cleaned;
    }

    console.warn('[Welcome] AI returned invalid welcome copy; using fallback.');
  } catch (error) {
    console.error('[Welcome] AI personalization failed; using fallback:', error.message);
  }

  return fallbackWelcome(displayName);
}

module.exports = {
  name: Events.GuildMemberAdd,
  async execute(member) {
    try {
      const channel = await member.guild.channels.fetch(WELCOME_CHANNEL_ID).catch(() => null);

      if (!channel || !channel.isTextBased() || !channel.send) {
        console.warn(`[Welcome] Welcome channel ${WELCOME_CHANNEL_ID} was not found or is not a text channel.`);
        return;
      }

      const personalizedWelcome = await createPersonalizedWelcome(member);

      const embed = new EmbedBuilder()
        .setColor(0x731d62)
        .setTitle('WELCOME TO TRUCKERS MP - eCLUB')
        .setDescription(
          `Welcome aboard, **${member.displayName || member.user.username}**!\n\n` +
          `${personalizedWelcome}\n\n` +
          `**Start here:** <#${config.channels.TEXT.INFO}>\n` +
          '**Explore the community, learn how Truckers MP works, and get rolling!**'
        )
        .setThumbnail(member.displayAvatarURL({ extension: 'png', size: 256 }))
        .setImage(WELCOME_BANNER_URL)
        .addFields(
          { name: 'YOUR JOURNEY STARTS HERE', value: 'Read the server guide, get to know the community, and make yourself at home.', inline: false },
          { name: 'DRIVE SAFE. ENJOY THE RIDE.', value: 'Welcome to the eClub family.', inline: false }
        )
        .setFooter({ text: 'Truckers MP - eClub • Community & Convoy' })
        .setTimestamp();

      // Ping only the new member; no role mentions.
      await channel.send({
        content: `Welcome <@${member.id}> to Truckers MP - eClub!`,
        embeds: [embed],
        allowedMentions: {
          users: [member.id]
        }
      });

      console.log(`[Welcome] Welcomed ${member.user.tag} (${member.id}) in #${channel.name}.`);
    } catch (error) {
      console.error('[Welcome] Failed to send welcome message:', error);
    }
  }
};
