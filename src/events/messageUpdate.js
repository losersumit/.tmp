/**
 * messageUpdate Event — Embed-load Moderation
 *
 * When a user sends a Tenor/Giphy GIF or any URL, Discord silently edits
 * the message a moment later to attach embed metadata. This event fires
 * for that silent edit. We use it as a safety net to catch GIF embeds
 * that arrived after messageCreate already ran (and saw empty embeds).
 *
 * We ONLY act if:
 *   - The old message had no embeds and the new one does (i.e. this is
 *     the embed-load edit, not a user edit with content changes)
 *   - The new embed contains a Tenor or Giphy GIF URL
 */

const { Events, EmbedBuilder } = require('discord.js');
const { moderateGifVideo } = require('../features/moderation');
const { addWarning } = require('../systems/moderationStorage');
const { logMessageModeration, takeModAction, getActionDescription } = require('../utils/moderationUtils');
const { isChannelOrCategoryIgnored } = require('../utils/discordUtils');
const config = require('../config');

const { ignoredChannels, ignoredCategories, ignoredRoles, appearance } = config.moderation;

// Track message IDs we've already moderated to avoid double-processing
// (messageCreate already handles content URLs; this catches stragglers)
const alreadyModerated = new Set();

module.exports = {
  name: Events.MessageUpdate,
  async execute(oldMessage, newMessage) {
    // Ignore bot messages
    if (newMessage.author?.bot) return;

    // Only act when embeds were added (the Discord embed-load edit)
    // i.e. old had 0 embeds, new has 1+ — AND content didn't change
    const embedsAdded = oldMessage.embeds?.length === 0 && newMessage.embeds?.length > 0;
    const contentUnchanged = oldMessage.content === newMessage.content;
    if (!embedsAdded || !contentUnchanged) return;

    // Avoid double-moderating a message we already handled in messageCreate
    if (alreadyModerated.has(newMessage.id)) {
      alreadyModerated.delete(newMessage.id); // clean up
      return;
    }

    // Apply same channel / role bypass rules
    const isIgnoredChannel = isChannelOrCategoryIgnored(newMessage.channel, ignoredChannels, ignoredCategories);
    const hasIgnoredRole = Boolean(
      newMessage.member &&
      newMessage.member.roles.cache.some(role => ignoredRoles.includes(role.id))
    );
    if (isIgnoredChannel || hasIgnoredRole) return;

    // Find any Tenor or Giphy GIF embeds in the newly-added embeds
    const gifEmbedUrls = [];
    for (const embed of newMessage.embeds) {
      const url = embed.url || embed.thumbnail?.url || embed.image?.url || '';
      if (
        url.includes('tenor.com') ||
        url.includes('giphy.com') ||
        /\.gif(\?.*)?$/i.test(url)
      ) {
        gifEmbedUrls.push(url);
      }
    }

    if (gifEmbedUrls.length === 0) return;

    try {
      let modResult = { isFlagged: false };

      for (const gifUrl of gifEmbedUrls) {
        console.log(`[MessageUpdate] Embed-load GIF detected, moderating: ${gifUrl.substring(0, 80)}...`);
        const result = await moderateGifVideo(gifUrl, 'gif');
        if (result.isFlagged) {
          modResult = result;
          break;
        }
      }

      if (!modResult.isFlagged) return;

      // Fetch full message if it was partial
      const message = newMessage.partial ? await newMessage.fetch() : newMessage;

      // Delete the offending message
      await message.delete().catch(() => {});

      // Record warning and determine automated action
      const { userData, recommendedAction } = await addWarning(
        message.author.id,
        modResult.reason,
        modResult.severity
      );

      // Log to mod-logs channel
      await logMessageModeration(
        message.client,
        message.guild,
        message.member,
        message.channel,
        modResult,
        userData,
        recommendedAction,
        message.content
      );

      // DM the user
      try {
        const severityColorMap = {
          high:   appearance.colors.highSeverity,
          medium: appearance.colors.mediumSeverity,
          low:    appearance.colors.lowSeverity
        };
        const severityEmojiMap = { high: '🔴', medium: '🟠', low: '🟡' };
        const sev = (modResult.severity || 'medium').toLowerCase();

        let warningMessage = 'Please be mindful of our community guidelines.';
        if (userData.count >= 3) warningMessage = '**⚠️ Warning:** Continued violations will result in moderation actions.';
        if (userData.count >= 5) warningMessage = '**⛔ Caution:** Your account is at risk of temporary restrictions.';
        if (userData.count >= 7) warningMessage = '**🚫 Final Warning:** Further violations will result in removal from the server.';

        const dmEmbed = new EmbedBuilder()
          .setColor(severityColorMap[sev] || appearance.colors.warning)
          .setTitle(`${severityEmojiMap[sev] || '⚠️'} Your GIF Was Moderated`)
          .setDescription(`A GIF you sent in ${message.channel} was removed for violating our community guidelines.`)
          .addFields(
            { name: '📝 Reason',        value: `\`${modResult.reason}\`` },
            { name: `${severityEmojiMap[sev] || '⚠️'} Severity`, value: `\`${modResult.severity.toUpperCase()}\``, inline: true },
            { name: '🔄 Warning Count', value: `\`${userData.count}\``, inline: true },
            { name: '⚠️ Notice',        value: warningMessage }
          )
          .setFooter({ text: 'AI-powered moderation' })
          .setTimestamp();

        await message.author.send({ embeds: [dmEmbed] });

        if (recommendedAction) {
          const actionEmbed = new EmbedBuilder()
            .setColor(appearance.colors.error)
            .setTitle('🛑 Moderation Action Applied')
            .setDescription('Due to multiple violations, the following action has been taken:')
            .addFields({ name: '🔨 Action', value: getActionDescription(recommendedAction) })
            .setFooter({ text: 'This action was applied automatically based on your warning history' })
            .setTimestamp();

          await message.author.send({ embeds: [actionEmbed] });
        }
      } catch (dmErr) {
        console.log(`[MessageUpdate] Could not DM ${newMessage.author?.tag}: ${dmErr.message}`);
        if (appearance.sendChannelNotificationsWhenDMFails) {
          try {
            const notice = await newMessage.channel.send(
              `${newMessage.author}, your GIF was removed for violating community guidelines. Please check server rules.`
            );
            setTimeout(() => notice.delete().catch(() => {}), appearance.channelNotificationTimeout);
          } catch {}
        }
      }

      // Execute the automated punishment
      if (recommendedAction && message.member) {
        await takeModAction(message.client, message.member, recommendedAction, message.guild, modResult.reason);
      }

    } catch (err) {
      console.error(`[messageUpdate] Unhandled error during GIF embed moderation: ${err.message}`, err);
    }
  }
};
