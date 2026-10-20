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

/**
 * Checks whether a channel, thread, or forum post is ignored based on ignoredChannels and ignoredCategories.
 * Handles threads and forum posts where message.channel.parent is the forum channel and parent.parentId is the category.
 *
 * @param {import('discord.js').Channel} channel
 * @param {string[]} ignoredChannels
 * @param {string[]} ignoredCategories
 * @returns {boolean}
 */
function isChannelOrCategoryIgnored(channel, ignoredChannels = [], ignoredCategories = []) {
  if (!channel) return false;

  const chanId = channel.id;
  const parentId = channel.parentId;
  // If channel is a thread/forum post, channel.parent is the forum/text channel
  const parentChannel = channel.parent;
  const grandParentId = parentChannel?.parentId;

  // 1. Direct channel match (or thread parent channel match)
  if (Array.isArray(ignoredChannels)) {
    if (ignoredChannels.includes(chanId)) return true;
    if (parentId && ignoredChannels.includes(parentId)) return true;
  }

  // 2. Category match
  if (Array.isArray(ignoredCategories)) {
    // Regular channel directly in category:
    if (parentId && ignoredCategories.includes(parentId)) return true;
    // Thread / forum post in a channel under category:
    if (grandParentId && ignoredCategories.includes(grandParentId)) return true;
  }

  return false;
}

module.exports = {
  resolveAttachmentFromLink,
  isChannelOrCategoryIgnored
};

