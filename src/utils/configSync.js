const fs = require('fs');
const path = require('path');
const { ChannelType } = require('discord.js');

/**
 * Normalizes Discord channel or role name into a clean, human-readable JS identifier.
 * e.g., "┇💬┇ᴄʜᴀᴛ" -> "CHAT", "[🌐] COMMUNITY" -> "COMMUNITY"
 */
function toKeyName(str) {
  // Normalize unicode letters (e.g. small caps ᴄʜᴀᴛ -> CHAT)
  let normalized = str.normalize('NFKD');
  
  // Custom mapping for mathematical / small capital alphabets if not decomposed by NFKD
  const charMap = {
    '🔑': 'ADMIN_KEY',
    '❄': 'SNOW',
    'ᴀ': 'A', 'ʙ': 'B', 'ᴄ': 'C', 'ᴅ': 'D', 'ᴇ': 'E', 'ғ': 'F', 'ɢ': 'G', 'ʜ': 'H',
    'ɪ': 'I', 'ᴊ': 'J', 'ᴋ': 'K', 'ʟ': 'L', 'ᴍ': 'M', 'ɴ': 'N', 'ᴏ': 'O', 'ᴘ': 'P',
    'ǫ': 'Q', 'ʀ': 'R', 'ꜱ': 'S', 'ᴛ': 'T', 'ᴜ': 'U', 'ᴠ': 'V', 'ᴡ': 'W', 'x': 'X',
    'ʏ': 'Y', 'ᴢ': 'Z', '𝟣': '1', '𝟤': '2', '𝟥': '3', '𝟦': '4', '𝟧': '5'
  };
  normalized = normalized.split('').map(ch => charMap[ch] || ch).join('');

  // Remove emojis and special symbols, replace spaces/hyphens with underscore
  let cleaned = normalized
    .replace(/[^\w\s-]/g, '')
    .trim()
    .replace(/[-\s]+/g, '_')
    .toUpperCase();

  // Ensure valid JS identifier
  if (/^[0-9]/.test(cleaned)) {
    cleaned = '_' + cleaned;
  }
  return cleaned || 'UNKNOWN';
}

/**
 * Fetches all roles and channels from the primary guild and updates roles.js and channels.js
 * @param {import('discord.js').Client} client
 */
async function syncServerConfig(client) {
  try {
    const guild = client.guilds.cache.get('1558597413357363263') || client.guilds.cache.first();
    if (!guild) {
      console.warn('[Sync] No guilds found to sync configuration.');
      return;
    }

    console.log(`[Sync] Synchronizing roles and channels for server: "${guild.name}" (${guild.id})...`);

    const rolesFetch = await guild.roles.fetch();
    const channelsFetch = await guild.channels.fetch();

    // 1. Process Roles
    const rolesList = Array.from(rolesFetch.values()).sort((a, b) => b.position - a.position);
    const rolesMap = {};
    const staffRoles = [];

    for (const r of rolesList) {
      const key = toKeyName(r.name);
      // Ensure unique keys
      let uniqueKey = key;
      let counter = 2;
      while (rolesMap[uniqueKey] && rolesMap[uniqueKey] !== r.id) {
        uniqueKey = `${key}_${counter++}`;
      }
      rolesMap[uniqueKey] = r.id;

      // Identify admin/staff roles
      if (r.permissions && (r.permissions.has('Administrator') || r.permissions.has('ManageGuild'))) {
        staffRoles.push(r.id);
      }
    }

    // Always include key role if present
    if (rolesMap['KEY'] && !staffRoles.includes(rolesMap['KEY'])) {
      staffRoles.push(rolesMap['KEY']);
    }

    const rolesContent = `/**
 * Auto-generated Discord Server Roles Mapping
 * Updated automatically on bot startup.
 * Guild: ${guild.name} (${guild.id})
 * Timestamp: ${new Date().toISOString()}
 */

module.exports = {
${Object.entries(rolesMap).map(([k, id]) => `  ${JSON.stringify(k)}: ${JSON.stringify(id)},`).join('\n')}

  // Groups of roles for permissions
  STAFF_ROLES: ${JSON.stringify(staffRoles, null, 2).replace(/\n/g, '\n  ')}
};
`;

    // 2. Process Channels
    const channelsList = Array.from(channelsFetch.values()).filter(Boolean);
    const categoriesMap = {};
    const textChannelsMap = {};
    const voiceChannelsMap = {};

    for (const c of channelsList) {
      const key = toKeyName(c.name);

      if (c.type === ChannelType.GuildCategory) {
        let uniqueKey = key;
        let counter = 2;
        while (categoriesMap[uniqueKey] && categoriesMap[uniqueKey] !== c.id) {
          uniqueKey = `${key}_${counter++}`;
        }
        categoriesMap[uniqueKey] = c.id;
      } else if (c.isVoiceBased()) {
        let uniqueKey = key;
        let counter = 2;
        while (voiceChannelsMap[uniqueKey] && voiceChannelsMap[uniqueKey] !== c.id) {
          uniqueKey = `${key}_${counter++}`;
        }
        voiceChannelsMap[uniqueKey] = c.id;
      } else {
        let uniqueKey = key;
        let counter = 2;
        while (textChannelsMap[uniqueKey] && textChannelsMap[uniqueKey] !== c.id) {
          uniqueKey = `${key}_${counter++}`;
        }
        textChannelsMap[uniqueKey] = c.id;
      }
    }

    // Provide friendly aliases
    const cabinId = textChannelsMap['HEADQUARTERS'] || textChannelsMap['CABIN'] || '1560281139921297540';
    const chatId = textChannelsMap['CHAT'] || '1558597414972039175';

    const channelsContent = `/**
 * Auto-generated Discord Server Channels Mapping
 * Updated automatically on bot startup.
 * Guild: ${guild.name} (${guild.id})
 * Timestamp: ${new Date().toISOString()}
 */

module.exports = {
  GUILD_ID: ${JSON.stringify(guild.id)},

  // Primary Common Aliases
  CABIN: ${JSON.stringify(cabinId)},
  HEADQUARTERS: ${JSON.stringify(cabinId)},
  CHAT: ${JSON.stringify(chatId)},

  // Categories
  CATEGORIES: {
${Object.entries(categoriesMap).map(([k, id]) => `    ${JSON.stringify(k)}: ${JSON.stringify(id)},`).join('\n')}
  },

  // Text & Announcement Channels
  TEXT: {
${Object.entries(textChannelsMap).map(([k, id]) => `    ${JSON.stringify(k)}: ${JSON.stringify(id)},`).join('\n')}
  },

  // Voice & Stage Channels
  VOICE: {
${Object.entries(voiceChannelsMap).map(([k, id]) => `    ${JSON.stringify(k)}: ${JSON.stringify(id)},`).join('\n')}
  }
};
`;

    const configDir = path.join(__dirname, '..', 'config');
    fs.writeFileSync(path.join(configDir, 'roles.js'), rolesContent, 'utf8');
    fs.writeFileSync(path.join(configDir, 'channels.js'), channelsContent, 'utf8');

    console.log(`[Sync] Successfully updated roles.js (${rolesList.length} roles) and channels.js (${channelsList.length} channels).`);
  } catch (error) {
    console.error('[Sync] Error syncing roles and channels:', error);
  }
}

module.exports = {
  syncServerConfig
};
