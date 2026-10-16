const { Events, EmbedBuilder } = require('discord.js');
const config = require('../config');

// Welcome settings for Truckers MP - eClub.
const WELCOME_CHANNEL_ID = config.channels.TEXT.CHAT;
const WELCOME_BANNER_URL = 'https://i.ibb.co/Gv1g9Vx7/tmp-banner.jpg';

module.exports = {
  name: Events.GuildMemberAdd,
  async execute(member) {
    try {
      const channel = await member.guild.channels.fetch(WELCOME_CHANNEL_ID).catch(() => null);

      if (!channel || !channel.isTextBased() || !channel.send) {
        console.warn(`[Welcome] Welcome channel ${WELCOME_CHANNEL_ID} was not found or is not a text channel.`);
        return;
      }

      const embed = new EmbedBuilder()
        .setColor(0x731d62)
        .setTitle('WELCOME TO TRUCKERS MP - eCLUB')
        .setDescription(
          `Welcome aboard, **${member.user.username}**!\n\n` +
          'We’re glad to have you with us. Get comfortable, meet fellow drivers, and enjoy the journey.\n\n' +
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

      // Ping only the new member; do not mention any role.
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
