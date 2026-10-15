/**
 * Resolves an attachment or media link from a Discord message link.
 * @param {import('discord.js').Client} client - The Discord client.
 * @param {string} messageLink - Discord message jump link
 * @returns {Promise<{url: string, isAttachment: boolean}|null>}
 */
async function resolveAttachmentFromLink(client, messageLink) {
  if (!messageLink || !messageLink.includes('discord.com/channels/')) {
    return null;
  }

  try {
    const parts = messageLink.split('/');
    const messageId = parts.pop();
    const channelId = parts.pop();

    const channel = await client.channels.fetch(channelId);
    if (!channel || !channel.isTextBased()) {
      return null;
    }

    const message = await channel.messages.fetch(messageId);
    if (!message) {
      return null;
    }

    if (message.attachments.size > 0) {
      return { url: message.attachments.first().url, isAttachment: true };
    }

    const urlRegex = /(https?:\/\/[^\s]+)/g;
    const match = message.content.match(urlRegex);
    if (match) {
      const cleanUrl = match[0].replace(/[>)\].]+$/, '');
      return { url: cleanUrl, isAttachment: false };
    }

    return null;
  } catch (error) {
    console.error('Error resolving attachment from link:', error.message);
    return null;
  }
}

module.exports = {
  resolveAttachmentFromLink
};
