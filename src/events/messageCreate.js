const { Events, EmbedBuilder } = require('discord.js');
const { handleTodoCommand } = require('../features/todoCommands');
const { handleClearWarnings } = require('../features/modCommands');
const { handleRagChat } = require('../features/ragChat');
const { moderateMessage, moderateImage, moderateGifVideo } = require('../features/moderation');
const { addWarning } = require('../systems/moderationStorage');
const { logMessageModeration, takeModAction, getActionDescription } = require('../utils/moderationUtils');
const config = require('../config');

const { ignoredChannels, ignoredRoles, imageOnlyChannels, appearance } = config.moderation;

module.exports = {
  name: Events.MessageCreate,
  async execute(message, client) {
    if (message.author.bot) return;

    // ── Image-Only Channel Enforcement ─────────────────────────────────────────
    // Channels like FLEET_SHOWCASE only allow images/attachments. Plain text is deleted.
    const isImageOnlyChannel = Array.isArray(imageOnlyChannels) && imageOnlyChannels.includes(message.channel.id);
    if (isImageOnlyChannel) {
      const hasImageAttachment = message.attachments.some(a => {
        const type = a.contentType || '';
        return type.startsWith('image/') || /\.(png|jpe?g|webp|gif)$/i.test(a.url);
      });

      const mediaUrlRegex = /https?:\/\/(?:www\.)?(?:tenor\.com\/view\/[^\s]+|media\.tenor\.com\/[^\s]+|giphy\.com\/gifs\/[^\s]+|media\.giphy\.com\/[^\s]+|i\.giphy\.com\/[^\s]+|[^\s]+\.(?:gif|png|jpe?g|webp))(?:\?[^\s]*)?/i;
      const hasMediaUrl = mediaUrlRegex.test(message.content || '');

      if (!hasImageAttachment && !hasMediaUrl) {
        await message.delete().catch(() => {});
        try {
          const warningMsg = await message.channel.send(
            `⚠️ ${message.author}, this channel is reserved for **images only**. Text-only messages are not allowed.`
          );
          setTimeout(() => warningMsg.delete().catch(() => {}), appearance?.channelNotificationTimeout || 5000);
        } catch {}
        return;
      }
    }

    // ── Prefix Commands ──────────────────────────────────────────────────────
    if (message.content.startsWith('!')) {
      const args = message.content.slice(1).trim().split(/\s+/);
      const commandName = args.shift()?.toLowerCase();

      if (commandName === 'todo') {
        console.log(`[Command] !todo executed by ${message.author.tag} in channel ${message.channelId}`);
        await handleTodoCommand(message, args, client);
        return;
      }

      if (commandName === 'cw' || commandName === 'clearwarnings') {
        console.log(`[Command] !cw executed by ${message.author.tag} in channel ${message.channelId}`);
        await handleClearWarnings(message, args, client);
        return;
      }
    }

    // ── Moderation Gate ──────────────────────────────────────────────────────
    // Skip moderation for ignored channels or privileged roles
    const isIgnoredChannel = ignoredChannels.includes(message.channel.id);
    const hasIgnoredRole = Boolean(
      message.member &&
      message.member.roles.cache.some(role => ignoredRoles.includes(role.id))
    );
    const shouldModerate = !isIgnoredChannel && !hasIgnoredRole;

    try {
      if (shouldModerate) {
        // ── Step 1: Text Moderation (Groq) ─────────────────────────────────
        let modResult = await moderateMessage(message.content);

        // ── Step 2: Attachment Moderation ──────────────────────────────────
        if (!modResult.isFlagged && message.attachments.size > 0) {
          for (const [, attachment] of message.attachments) {
            const type = attachment.contentType || '';

            if (type.startsWith('image/gif') || attachment.url.endsWith('.gif')) {
              // GIF → extract 5 frames → Gemini
              const gifResult = await moderateGifVideo(attachment.url, 'gif');
              if (gifResult.isFlagged) { modResult = gifResult; break; }

            } else if (
              type.startsWith('video/') ||
              /\.(mp4|webm|mov|mkv)$/i.test(attachment.url)
            ) {
              // Video → extract 5 frames → Gemini
              const ext = attachment.url.match(/\.(mp4|webm|mov|mkv)$/i)?.[1] || 'mp4';
              const videoResult = await moderateGifVideo(attachment.url, ext);
              if (videoResult.isFlagged) { modResult = videoResult; break; }

            } else if (type.startsWith('image/')) {
              // Static image → Gemini direct
              const imgResult = await moderateImage(attachment.url);
              if (imgResult.isFlagged) { modResult = imgResult; break; }
            }
          }
        }

        // ── Step 3: Media URLs in message.content ──────────────────────────
        // Discord GIF picker sends Tenor/Giphy as a bare URL in message.content.
        // message.embeds is always EMPTY at messageCreate time — Discord fills
        // it in later via a silent message edit (caught by messageUpdate.js).
        // So we scan the raw content text for known media URL patterns instead.
        if (!modResult.isFlagged) {
          const mediaUrlRegex =
            /https?:\/\/(?:www\.)?(?:tenor\.com\/view\/[^\s]+|media\.tenor\.com\/[^\s]+|giphy\.com\/gifs\/[^\s]+|media\.giphy\.com\/[^\s]+|i\.giphy\.com\/[^\s]+|[^\s]+\.(?:gif|mp4|webm|mov))(?:\?[^\s]*)?/gi;

          const foundUrls = [...new Set(message.content.match(mediaUrlRegex) || [])];

          for (const mediaUrl of foundUrls) {
            const ext = mediaUrl.match(/\.(mp4|webm|mov)$/i)?.[1] || 'gif';
            console.log(`[Moderation] Detected media URL in content: ${mediaUrl.substring(0, 80)}...`);
            const mediaResult = await moderateGifVideo(mediaUrl, ext);
            if (mediaResult.isFlagged) {
              modResult = mediaResult;
              break;
            }
          }
        }

        // ── Step 4: Enforcement ─────────────────────────────────────────────
        if (modResult.isFlagged) {
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
            client,
            message.guild,
            message.member,
            message.channel,
            modResult,
            userData,
            recommendedAction,
            message.content
          );

          // DM the user with a severity embed
          try {
            const severityColorMap = {
              high:   appearance.colors.highSeverity,
              medium: appearance.colors.mediumSeverity,
              low:    appearance.colors.lowSeverity
            };
            const severityEmojiMap = { high: '🔴', medium: '🟠', low: '🟡' };
            const sev = (modResult.severity || 'medium').toLowerCase();

            let warningMessage = 'Please be mindful of our community guidelines.';
            if (userData.count >= 3)  warningMessage = '**⚠️ Warning:** Continued violations will result in moderation actions.';
            if (userData.count >= 5)  warningMessage = '**⛔ Caution:** Your account is at risk of temporary restrictions.';
            if (userData.count >= 7)  warningMessage = '**🚫 Final Warning:** Further violations will result in removal from the server.';

            const dmEmbed = new EmbedBuilder()
              .setColor(severityColorMap[sev] || appearance.colors.warning)
              .setTitle(`${severityEmojiMap[sev] || '⚠️'} Your Message Was Moderated`)
              .setDescription(`Your message in ${message.channel} was removed for violating our community guidelines.`)
              .addFields(
                { name: '📝 Reason',        value: `\`${modResult.reason}\`` },
                { name: `${severityEmojiMap[sev] || '⚠️'} Severity`, value: `\`${modResult.severity.toUpperCase()}\``, inline: true },
                { name: '🔄 Warning Count', value: `\`${userData.count}\``, inline: true },
                { name: '⚠️ Notice',        value: warningMessage }
              )
              .setFooter({ text: 'AI-powered moderation' })
              .setTimestamp();

            await message.author.send({ embeds: [dmEmbed] });

            // If an automated action was applied, send a second DM explaining it
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
            console.log(`[Moderation] Could not DM ${message.author.tag}: ${dmErr.message}`);

            // Fall back to a brief channel notice if DMs are closed
            if (appearance.sendChannelNotificationsWhenDMFails) {
              try {
                const notice = await message.channel.send(
                  `${message.author}, your message was removed for violating community guidelines. Please check server rules.`
                );
                setTimeout(() => notice.delete().catch(() => {}), appearance.channelNotificationTimeout);
              } catch (noticeErr) {
                console.error(`[Moderation] Could not send channel notice: ${noticeErr.message}`);
              }
            }
          }

          // Execute the automated punishment (timeout / kick / ban)
          if (recommendedAction && message.member) {
            await takeModAction(client, message.member, recommendedAction, message.guild, modResult.reason);
          }

          // Message was moderated — stop processing (no chat/RAG)
          return;
        }
      }

      // ── Chatbot and RAG Message Handler ────────────────────────────────────
      await handleRagChat(message, client);

    } catch (err) {
      console.error(`[messageCreate] Unhandled error: ${err.message}`, err);
    }
  }
};
