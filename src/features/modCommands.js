/**
 * Moderation Commands (!cw, etc.)
 *
 * Provides moderation command handling.
 * Role check for !cw: role configured via config.moderation.partnerRoleId (no hardcoded IDs).
 */

const { EmbedBuilder } = require('discord.js');
const { getUserWarnings, resetWarnings } = require('../systems/moderationStorage');
const { findModLogChannel } = require('../utils/moderationUtils');
const config = require('../config');

/**
 * Resolve target user from mention, user ID, or username.
 * Supports:
 *  - Direct mention (<@123...>)
 *  - User ID snowflake (18-19 digit string)
 *  - Username or display name match in the guild
 *  - Direct user fetch by ID even if member left the server
 *
 * @param {Message} message
 * @param {string} targetArg
 * @param {Client} client
 * @returns {Promise<{ user: User, member: GuildMember|null }|null>}
 */
async function resolveTargetUser(message, targetArg, client) {
  if (!targetArg) return null;

  // 1. Check user mention
  const mentionedMember = message.mentions.members?.first();
  if (mentionedMember) {
    return { user: mentionedMember.user, member: mentionedMember };
  }
  const mentionedUser = message.mentions.users?.first();
  if (mentionedUser) {
    const member = message.guild?.members.cache.get(mentionedUser.id) || null;
    return { user: mentionedUser, member };
  }

  // 2. Try as raw Discord snowflake ID (strip non-digits)
  const cleanId = targetArg.replace(/[^0-9]/g, '');
  if (cleanId && cleanId.length >= 17) {
    // Try to find member in guild
    try {
      const member = await message.guild.members.fetch(cleanId);
      if (member) return { user: member.user, member };
    } catch {
      // User not in server
    }

    // Try to fetch global User by ID
    try {
      const user = await client.users.fetch(cleanId);
      if (user) return { user, member: null };
    } catch {
      // Invalid user ID
    }
  }

  // 3. Search members in guild by query (username / display name)
  try {
    const cleanQuery = targetArg.replace(/^@/, '').toLowerCase();
    const fetchedMembers = await message.guild.members.fetch({ query: cleanQuery, limit: 5 });
    if (fetchedMembers.size > 0) {
      // Match exact username or displayName first if possible
      const exactMatch = fetchedMembers.find(
        m => m.user.username.toLowerCase() === cleanQuery ||
             m.displayName.toLowerCase() === cleanQuery ||
             m.user.tag.toLowerCase() === cleanQuery
      );
      const chosen = exactMatch || fetchedMembers.first();
      return { user: chosen.user, member: chosen };
    }
  } catch {
    // Member fetch query failed or unsupported
  }

  return null;
}

/**
 * Handle the !cw command (Clear Warnings).
 * Allowed only for users with the configured partnerRoleId.
 *
 * @param {Message} message
 * @param {string[]} args
 * @param {Client} client
 */
async function handleClearWarnings(message, args, client) {
  const allowedRoleId = config.moderation.partnerRoleId;

  // Check if member possesses the required role
  const hasPermission = Boolean(
    allowedRoleId && message.member?.roles.cache.has(allowedRoleId)
  );

  if (!hasPermission) {
    return message.reply('❌ You do not have permission to use this command.');
  }

  const targetArg = args[0];
  if (!targetArg) {
    return message.reply('❌ Usage: `!cw @user` or `!cw <user_id>` or `!cw <username>`');
  }

  const resolved = await resolveTargetUser(message, targetArg, client);
  if (!resolved || !resolved.user) {
    return message.reply(`❌ Could not find user: \`${targetArg}\`. Use mention, ID, or username.`);
  }

  const { user, member } = resolved;
  const warningsData = await getUserWarnings(user.id);
  const previousCount = warningsData ? warningsData.count : 0;

  if (previousCount === 0) {
    return message.reply(`ℹ️ **${user.tag}** has no active warnings to clear.`);
  }

  const success = await resetWarnings(user.id);
  if (!success) {
    return message.reply(`❌ Failed to clear warnings for **${user.tag}** due to a database error.`);
  }

  // Confirmation reply
  const replyEmbed = new EmbedBuilder()
    .setColor(config.moderation.appearance.colors.success || '#00CC66')
    .setTitle('✅ Warnings Cleared')
    .setDescription(`Successfully cleared all **${previousCount}** warning(s) for **${user.tag}** (<@${user.id}>).`)
    .setFooter({ text: `Action by ${message.author.tag}` })
    .setTimestamp();

  await message.reply({ embeds: [replyEmbed] });

  // Log action to mod-logs channel
  const logChannel = findModLogChannel(message.guild);
  if (logChannel) {
    const logEmbed = new EmbedBuilder()
      .setColor(config.moderation.appearance.colors.info || '#0099FF')
      .setTitle('🛡️ Moderation Action: WARNINGS CLEARED')
      .setDescription(`Warnings reset for ${user.tag} (${user.id})`)
      .addFields(
        { name: '👤 Target', value: `${user.tag} (<@${user.id}>)`, inline: true },
        { name: '🛡️ Moderator', value: `${message.author.tag} (<@${message.author.id}>)`, inline: true },
        { name: '📊 Warnings Cleared', value: `${previousCount}`, inline: true },
        { name: '📝 Reason', value: `Manually cleared via !cw command` }
      )
      .setFooter({ text: `AI Moderation System | Target ID: ${user.id}` })
      .setTimestamp();

    if (user.avatarURL && user.avatarURL()) {
      logEmbed.setThumbnail(user.avatarURL());
    }

    try {
      await logChannel.send({ embeds: [logEmbed] });
    } catch (err) {
      console.error('[ModCommands] Failed to send clear warnings log:', err.message);
    }
  }
}

module.exports = {
  handleClearWarnings,
  resolveTargetUser
};
