const { Events, EmbedBuilder } = require('discord.js');
const config = require('../config');
const { getChatCompletionForFeature } = require('../utils/aiUtils');

// Welcome settings for Truckers MP - eClub.
const WELCOME_CHANNEL_ID = config.channels.TEXT.CHAT;
const WELCOME_BANNER_URL = 'https://i.ibb.co/Gv1g9Vx7/tmp-banner.jpg';

async function createPersonalizedWelcome(member) {
  const displayName = member.displayName || member.user.globalName || member.user.username;
  const username = member.user.username;

  try {
    const response = await getChatCompletionForFeature('welcome', [
      {
        role: 'system',
        content: [
          'Write a warm, concise, personalized Discord welcome for a new member of Truckers MP - eClub, a trucking community.',
          'Use the supplied username and display name naturally, without making assumptions about their personality, identity, experience, or interests.',
          'Do not include role mentions, user mentions, markdown headings, emojis, or claims about the person.',
          'Return only 1-2 short sentences, maximum 45 words.'
        ].join(' ')
      },
      {
        role: 'user',
        content: `Username: ${username}\nDisplay name: ${displayName}\nWrite their welcome message.`
      }
    ]);

    const cleaned = response
      .replace(/<@&?\d+>/g, '')
      .replace(/@everyone|@here/gi, '')
      .trim();

    if (cleaned) return cleaned.slice(0, 900);
  } catch (error) {
    console.error('[Welcome] AI personalization failed; using fallback:', error.message);
  }

  return `We’re glad to have you with us. Meet fellow drivers, settle in, and get ready for the road ahead!`;
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
