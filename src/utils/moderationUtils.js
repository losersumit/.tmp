/**
 * Moderation Utilities — Action Enforcement & Discord Embed Logging
 *
 * Handles:
 *  - takeModAction: timeout/kick/ban against members
 *  - logModAction: embed log for member punishments
 *  - logMessageModeration: embed log for flagged messages
 *  - getActionDescription: human-readable action strings
 */

const { EmbedBuilder, PermissionFlagsBits } = require('discord.js');
const { getUserWarnings } = require('../systems/moderationStorage');
const config = require('../config');

const { colors } = config.moderation.appearance;
const { logChannelId, modLogChannels, includeMessageContent, censorMessageContent, maxContentLength, consoleLog } = config.moderation.logging;

// ─── Helpers ──────────────────────────────────────────────────────────────────

/**
 * Find the mod-logs channel in a guild by searching configured channel ID first, then channel names.
 * @param {Guild} guild
 * @returns {TextChannel|null}
 */
function findModLogChannel(guild) {
  // 1. Check direct configured channel ID if present
  if (logChannelId) {
    const chById = guild.channels.cache.get(logChannelId);
    if (chById && chById.isTextBased()) return chById;
  }

  // 2. Search common channel names
  for (const name of modLogChannels) {
    const ch = guild.channels.cache.find(
      c => c.name.toLowerCase() === name && c.isTextBased()
    );
    if (ch) return ch;
  }
  return null;
}

/**
 * Get a human-readable description for a moderation action code.
 * @param {string} action
 * @returns {string}
 */
function getActionDescription(action) {
  switch (action) {
    case 'timeout_1h':  return '⏱️ **Timeout (1 hour)** — Temporarily muted for 1 hour';
    case 'timeout_24h': return '⏱️ **Timeout (24 hours)** — Temporarily muted for 24 hours';
    case 'kick':        return '👢 **Kicked** — Removed from the server (may rejoin with an invite)';
    case 'ban':         return '🔨 **Banned** — Permanently removed from the server';
    default:            return `⚠️ **${action}**`;
  }
}

// ─── Action Enforcement ────────────────────────────────────────────────────────

/**
 * Execute a moderation action against a guild member.
 *
 * @param {Client} client
 * @param {GuildMember} member
 * @param {'timeout_1h'|'timeout_24h'|'kick'|'ban'} action
 * @param {Guild} guild
 * @param {string} reason
 */
async function takeModAction(client, member, action, guild, reason) {
  try {
    const fullReason = `AI Moderation: ${reason}`;

    switch (action) {
      case 'timeout_1h':
        await member.timeout(60 * 60 * 1000, fullReason);
        await logModAction(client, guild, member, 'timeout (1 hour)', fullReason);
        break;

      case 'timeout_24h':
        await member.timeout(24 * 60 * 60 * 1000, fullReason);
        await logModAction(client, guild, member, 'timeout (24 hours)', fullReason);
        break;

      case 'kick':
        await member.kick(fullReason);
        await logModAction(client, guild, member, 'kick', fullReason);
        break;

      case 'ban':
        await member.ban({ reason: fullReason, deleteMessageSeconds: 60 * 60 * 24 });
        await logModAction(client, guild, member, 'ban', fullReason);
        break;

      default:
        console.warn(`[ModerationUtils] Unknown action: ${action}`);
    }
  } catch (err) {
    console.error(`[ModerationUtils] Error taking mod action "${action}":`, err.message);
  }
}

// ─── Embed Logging ─────────────────────────────────────────────────────────────

/**
 * Log a moderation enforcement action (timeout/kick/ban) to the mod-log channel.
 *
 * @param {Client} client
 * @param {Guild} guild
 * @param {GuildMember} member
 * @param {string} action - Human-readable action name
 * @param {string} reason
 */
async function logModAction(client, guild, member, action, reason) {
  const logChannel = findModLogChannel(guild);
  if (!logChannel) {
    if (consoleLog) console.log(`[ModerationUtils] No mod-log channel found. Action: ${action.toUpperCase()} on ${member.user.tag}`);
    return;
  }

  // Color & emoji per action
  let actionColor = colors.warning;
  let actionEmoji = '🛡️';

  switch (action.toLowerCase()) {
    case 'timeout (1 hour)':  actionColor = colors.lowSeverity;    actionEmoji = '⏱️'; break;
    case 'timeout (24 hours)':actionColor = colors.warning;        actionEmoji = '⏱️'; break;
    case 'kick':               actionColor = colors.mediumSeverity; actionEmoji = '👢'; break;
    case 'ban':                actionColor = colors.error;          actionEmoji = '🔨'; break;
  }

  const warningData = await getUserWarnings(member.id);
  const warningCount = warningData.count;

  const now = new Date();
  const accountAgeDays = Math.floor((now - new Date(member.user.createdAt)) / 86400000);
  const serverAgeDays  = Math.floor((now - new Date(member.joinedAt)) / 86400000);

  const embed = new EmbedBuilder()
    .setColor(actionColor)
    .setTitle(`${actionEmoji} Moderation Action: ${action.toUpperCase()}`)
    .setDescription(`Action taken against ${member.user.tag} (<@${member.id}>)`)
    .addFields(
      { name: '👤 User',        value: `${member.user.tag} (<@${member.id}>)` },
      { name: '🔨 Action',      value: action.toUpperCase(), inline: true },
      { name: '⚠️ Warnings',    value: `${warningCount}`, inline: true },
      { name: '📝 Reason',      value: reason },
      { name: '🕒 Account Info', value: `Account Age: ${accountAgeDays} days\nServer Member: ${serverAgeDays} days` }
    )
    .setFooter({ text: `Moderator: ${client.user.tag} | AI Moderation` })
    .setTimestamp();

  if (config.moderation.appearance.showUserAvatarsInLogs && member.user.avatarURL()) {
    embed.setThumbnail(member.user.avatarURL());
  }

  try {
    await logChannel.send({ embeds: [embed] });
  } catch (err) {
    console.error(`[ModerationUtils] Failed to send mod action log:`, err.message);
  }
}

/**
 * Log a flagged message moderation event to the mod-log channel.
 *
 * @param {Client} client
 * @param {Guild} guild
 * @param {GuildMember} member
 * @param {TextChannel} channel - The channel the message was sent in
 * @param {Object} modResult - { reason, severity, categories, confidence }
 * @param {{ count: number }} userData
 * @param {string|null} recommendedAction
 * @param {string} messageContent - Original message text
 */
async function logMessageModeration(client, guild, member, channel, modResult, userData, recommendedAction, messageContent) {
  const logChannel = findModLogChannel(guild);
  if (!logChannel) return;

  // Color by severity
  const severityColorMap = {
    high:   colors.highSeverity,
    medium: colors.mediumSeverity,
    low:    colors.lowSeverity
  };
  const severityColor = severityColorMap[(modResult.severity || '').toLowerCase()] || colors.warning;

  const embed = new EmbedBuilder()
    .setColor(severityColor)
    .setTitle('🛡️ Message Moderated')
    .setDescription(`A message by ${member.user.tag} was removed from ${channel}.`)
    .addFields(
      { name: '👤 User',           value: `${member.user.tag} (<@${member.id}>)`, inline: true },
      { name: '📊 Warning Count',  value: `${userData.count}`, inline: true },
      { name: '⚠️ Severity',       value: (modResult.severity || 'unknown').toUpperCase(), inline: true },
      { name: '📝 Reason',         value: modResult.reason || 'No reason provided' }
    )
    .setFooter({ text: `AI Moderation | User ID: ${member.id}` })
    .setTimestamp();

  // Optional: include message content
  if (includeMessageContent && messageContent) {
    let contentToShow = messageContent;

    if (censorMessageContent) {
      contentToShow = contentToShow.replace(/(\w{1})(\w+)/g, (_, first, rest) => first + rest.replace(/./g, '*'));
    }

    const limit = maxContentLength || 1024;
    if (contentToShow.length > limit) contentToShow = contentToShow.substring(0, limit - 3) + '...';

    embed.addFields({ name: '📋 Message Content', value: contentToShow });
  }

  if (config.moderation.appearance.showUserAvatarsInLogs && member.user.avatarURL()) {
    embed.setThumbnail(member.user.avatarURL());
  }

  if (recommendedAction) {
    embed.addFields({ name: '🔨 Automated Action', value: getActionDescription(recommendedAction) });
  }

  try {
    await logChannel.send({ embeds: [embed] });
    if (consoleLog) console.log(`[ModerationUtils] Logged flagged message from ${member.user.tag} to #${logChannel.name}`);
  } catch (err) {
    console.error(`[ModerationUtils] Failed to send message moderation log:`, err.message);
  }
}

module.exports = { takeModAction, logModAction, logMessageModeration, getActionDescription, findModLogChannel };
