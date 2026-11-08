const config = require('../config');
const { uvsSupabase } = require('../database/supabase');
const { syncServerConfig, toKeyName } = require('../utils/configSync');

/**
 * Gets the primary Discord guild (Truckers MP - eClub).
 * @param {import('discord.js').Client} client
 * @returns {import('discord.js').Guild|null}
 */
function getPrimaryGuild(client) {
  const guildId = config.channels?.GUILD_ID || '1558597413357363263';
  return client.guilds.cache.get(guildId) || client.guilds.cache.first() || null;
}

/**
 * Finds the VTC role ID for a given approved guild name using roles.js and guild role cache.
 * @param {import('discord.js').Guild} discordGuild
 * @param {string} guildName
 * @returns {string|null} role ID
 */
function findVtcRoleId(discordGuild, guildName) {
  if (!guildName) return null;

  // 1. Check roles.js mapping by normalized key
  const roles = require('../config/roles');
  const roleKey = toKeyName(guildName);
  if (roles[roleKey]) {
    return roles[roleKey];
  }

  // 2. Fallback: match by role name (case-insensitive) in Discord guild cache
  const matchedRole = discordGuild.roles.cache.find(
    r => r.name.toLowerCase() === guildName.trim().toLowerCase()
  );
  return matchedRole ? matchedRole.id : null;
}

/**
 * Processes a single member for VTC role assignment and name tag prefixing.
 *
 * @param {import('discord.js').GuildMember} member
 * @param {Object} [cachedData] Optional cached approvedGuildsMap and playersMap for bulk operations
 * @returns {Promise<{ assignedVtcDriver: boolean, assignedGuildRole: boolean, updatedNick: boolean }>}
 */
async function processMemberVtcStatus(member, cachedData = {}) {
  const result = {
    assignedVtcDriver: false,
    assignedGuildRole: false,
    updatedNick: false
  };

  if (!member || member.user?.bot) {
    return result;
  }

  try {
    let player = cachedData.playersMap ? cachedData.playersMap.get(member.id) : null;
    let approvedGuildsMap = cachedData.approvedGuildsMap;

    // If no bulk cache provided, fetch directly from Supabase
    if (!player) {
      const { data: playerData, error: playerErr } = await uvsSupabase
        .from('players')
        .select('discord_id, guild_id, guild_tag, display_name, username')
        .eq('discord_id', member.id)
        .maybeSingle();

      if (playerErr) {
        console.error(`[VTCSync] Error checking player registration for ${member.user.tag}:`, playerErr.message);
        return result;
      }
      player = playerData;
    }

    if (!player || !player.guild_id) {
      // User is not registered in any VTC guild
      return result;
    }

    // Fetch approved guilds if not in cache
    let approvedGuild = null;
    if (approvedGuildsMap) {
      approvedGuild = approvedGuildsMap.get(player.guild_id);
    } else {
      const { data: guildData, error: guildErr } = await uvsSupabase
        .from('approved_guilds')
        .select('guild_id, guild_name, guild_tag, is_suspended, embed_color')
        .eq('guild_id', player.guild_id)
        .maybeSingle();

      if (guildErr) {
        console.error(`[VTCSync] Error checking approved guild ${player.guild_id}:`, guildErr.message);
        return result;
      }
      approvedGuild = guildData;
    }

    if (!approvedGuild) {
      console.log(`[VTCSync] Player ${member.user.tag} belongs to unapproved/unknown guild ID ${player.guild_id}.`);
      return result;
    }

    // Check if the guild is suspended
    if (approvedGuild.is_suspended) {
      console.log(`[VTCSync] Guild ${approvedGuild.guild_name} (${approvedGuild.guild_id}) is suspended. Skipping role assignment for ${member.user.tag}.`);
      return result;
    }

    // 1. Assign "VTC_DRIVERS" role from roles.js
    const vtcDriversRoleId = config.roles?.VTC_DRIVERS || '1563970910200008806';
    if (vtcDriversRoleId && !member.roles.cache.has(vtcDriversRoleId)) {
      try {
        await member.roles.add(vtcDriversRoleId);
        result.assignedVtcDriver = true;
        console.log(`[VTCSync] Added VTC_DRIVERS role to ${member.user.tag} (${member.id}).`);
      } catch (err) {
        console.error(`[VTCSync] Failed to add VTC_DRIVERS role to ${member.user.tag}:`, err.message);
      }
    }

    // 2. Assign the specific VTC role from approved_guilds and roles.js
    const vtcRoleId = findVtcRoleId(member.guild, approvedGuild.guild_name);
    if (vtcRoleId && !member.roles.cache.has(vtcRoleId)) {
      try {
        await member.roles.add(vtcRoleId);
        result.assignedGuildRole = true;
        console.log(`[VTCSync] Added VTC role "${approvedGuild.guild_name}" (${vtcRoleId}) to ${member.user.tag}.`);
      } catch (err) {
        console.error(`[VTCSync] Failed to add VTC role "${approvedGuild.guild_name}" to ${member.user.tag}:`, err.message);
      }
    }

    // 3. Add guild tag as it is before their name
    const guildTag = approvedGuild.guild_tag || player.guild_tag;
    if (guildTag) {
      const currentDisplayName = member.displayName || member.user.username;

      // If user's name already starts with the exact guild tag, skip changing
      if (!currentDisplayName.startsWith(guildTag)) {
        // Strip other old approved tags if present
        let cleanBase = currentDisplayName;
        if (cachedData.allTags && Array.isArray(cachedData.allTags)) {
          for (const oldTag of cachedData.allTags) {
            if (oldTag && cleanBase.startsWith(oldTag)) {
              cleanBase = cleanBase.slice(oldTag.length).trim();
              break;
            }
          }
        }
        cleanBase = cleanBase.replace(/^[|\-:\s]+/, '').trim() || member.user.username;

        const newNickname = `${guildTag} ${cleanBase}`.slice(0, 32);

        // Only attempt to change nickname if bot has permissions and user is manageable
        if (member.manageable && member.id !== member.guild.ownerId) {
          try {
            await member.setNickname(newNickname);
            result.updatedNick = true;
            console.log(`[VTCSync] Updated nickname for ${member.user.tag} -> "${newNickname}".`);
          } catch (nickErr) {
            console.warn(`[VTCSync] Could not update nickname for ${member.user.tag}:`, nickErr.message);
          }
        } else {
          console.log(`[VTCSync] Member ${member.user.tag} is not manageable (higher role or server owner); skipping nickname update.`);
        }
      }
    }
  } catch (error) {
    console.error(`[VTCSync] Unexpected error processing member ${member.user?.tag || member.id}:`, error);
  }

  return result;
}

/**
 * Sweeps all members in the server and syncs VTC Driver roles, guild roles, and nicknames.
 * Runs daily at 12 AM GMT.
 *
 * @param {import('discord.js').Client} client
 */
async function syncAllMembersVtcStatus(client) {
  const guild = getPrimaryGuild(client);
  if (!guild) {
    console.warn('[VTCSync] Primary guild not found for all-members sync.');
    return;
  }

  console.log(`[VTCSync] Starting member sync for server "${guild.name}" (${guild.id})...`);

  try {
    // 1. Fetch all guild members
    const members = await guild.members.fetch();
    console.log(`[VTCSync] Fetched ${members.size} members.`);

    // 2. Fetch all approved guilds
    const { data: approvedGuilds, error: guildErr } = await uvsSupabase
      .from('approved_guilds')
      .select('guild_id, guild_name, guild_tag, is_suspended, embed_color');

    if (guildErr) {
      console.error('[VTCSync] Failed to fetch approved guilds for sync:', guildErr.message);
      return;
    }

    const approvedGuildsMap = new Map();
    const allTags = [];
    for (const g of approvedGuilds || []) {
      approvedGuildsMap.set(g.guild_id, g);
      if (g.guild_tag) allTags.push(g.guild_tag);
    }

    // 3. Fetch all registered players
    const { data: players, error: playersErr } = await uvsSupabase
      .from('players')
      .select('discord_id, guild_id, guild_tag, display_name, username');

    if (playersErr) {
      console.error('[VTCSync] Failed to fetch players for sync:', playersErr.message);
      return;
    }

    const playersMap = new Map();
    for (const p of players || []) {
      playersMap.set(p.discord_id, p);
    }

    console.log(`[VTCSync] Loaded ${approvedGuildsMap.size} approved guilds and ${playersMap.size} registered players.`);

    const cachedData = {
      approvedGuildsMap,
      playersMap,
      allTags
    };

    let vtcDriverCount = 0;
    let vtcGuildRoleCount = 0;
    let nickCount = 0;

    for (const [, member] of members) {
      if (member.user.bot) continue;

      const res = await processMemberVtcStatus(member, cachedData);
      if (res.assignedVtcDriver) vtcDriverCount++;
      if (res.assignedGuildRole) vtcGuildRoleCount++;
      if (res.updatedNick) nickCount++;

      // Small throttle to avoid Discord rate limit spikes
      await new Promise(resolve => setTimeout(resolve, 50));
    }

    console.log(`[VTCSync] Daily sync completed: ${vtcDriverCount} VTC Drivers assigned, ${vtcGuildRoleCount} VTC guild roles assigned, ${nickCount} nicknames updated.`);
  } catch (error) {
    console.error('[VTCSync] Error during syncAllMembersVtcStatus:', error);
  }
}

/**
 * Creates a role for an approved guild right above the VTC_DRIVERS role.
 *
 * @param {import('discord.js').Guild} guild
 * @param {{ guild_name: string, embed_color?: number|string, guild_id?: string }} guildData
 * @returns {Promise<import('discord.js').Role|null>}
 */
async function createRoleForApprovedGuild(guild, guildData) {
  if (!guild || !guildData?.guild_name) return null;

  try {
    await guild.roles.fetch();

    const existingRole = guild.roles.cache.find(
      r => r.name.toLowerCase() === guildData.guild_name.trim().toLowerCase()
    );

    if (existingRole) {
      console.log(`[VTCRoles] Role "${guildData.guild_name}" already exists (${existingRole.id}).`);
      return existingRole;
    }

    const vtcDriversRoleId = config.roles?.VTC_DRIVERS || '1563970910200008806';
    const vtcDriversRole = guild.roles.cache.get(vtcDriversRoleId);

    let roleColor = 0;
    if (guildData.embed_color !== null && guildData.embed_color !== undefined) {
      roleColor = typeof guildData.embed_color === 'number'
        ? guildData.embed_color
        : parseInt(guildData.embed_color, 10) || 0;
    }

    const targetPosition = vtcDriversRole ? vtcDriversRole.position + 1 : undefined;

    console.log(`[VTCRoles] Creating role "${guildData.guild_name}" with color #${roleColor.toString(16).padStart(6, '0')} above VTC Drivers (pos ${targetPosition})...`);

    const newRole = await guild.roles.create({
      name: guildData.guild_name.trim(),
      color: roleColor,
      position: targetPosition,
      reason: `UVS VTC identity role for approved guild: ${guildData.guild_name}`
    });

    // Ensure position right above VTC Drivers if needed
    if (vtcDriversRole && newRole.position <= vtcDriversRole.position) {
      await newRole.setPosition(vtcDriversRole.position + 1).catch(err => {
        console.warn(`[VTCRoles] Could not move role position: ${err.message}`);
      });
    }

    console.log(`[VTCRoles] Created role "${newRole.name}" (${newRole.id}) at position ${newRole.position}.`);
    return newRole;
  } catch (error) {
    console.error(`[VTCRoles] Failed to create role for "${guildData.guild_name}":`, error);
    return null;
  }
}

/**
 * Checks all existing approved guilds and creates any missing roles.
 * Runs on bot startup.
 *
 * @param {import('discord.js').Client} client
 */
async function ensureAllApprovedGuildRolesExist(client) {
  const guild = getPrimaryGuild(client);
  if (!guild) return;

  try {
    const { data: approvedGuilds, error } = await uvsSupabase
      .from('approved_guilds')
      .select('guild_id, guild_name, embed_color');

    if (error || !approvedGuilds) {
      console.error('[VTCRoles] Failed to fetch approved guilds on startup:', error?.message);
      return;
    }

    await guild.roles.fetch();
    let createdCount = 0;

    for (const g of approvedGuilds) {
      const exists = guild.roles.cache.some(
        r => r.name.toLowerCase() === g.guild_name.trim().toLowerCase()
      );

      if (!exists) {
        const created = await createRoleForApprovedGuild(guild, g);
        if (created) createdCount++;
      }
    }

    if (createdCount > 0) {
      console.log(`[VTCRoles] Created ${createdCount} missing approved guild roles. Syncing roles.js...`);
      await syncServerConfig(client);
    }
  } catch (error) {
    console.error('[VTCRoles] Error in ensureAllApprovedGuildRolesExist:', error);
  }
}

/**
 * Listens to Realtime INSERT events on the approved_guilds table.
 * As soon as a new row is added, creates the role above VTC Drivers role and syncs config.
 *
 * @param {import('discord.js').Client} client
 */
function listenToApprovedGuilds(client) {
  console.log('[VTCRoles] Starting Realtime listener on "approved_guilds" table...');

  const channel = uvsSupabase
    .channel('approved-guilds-role-listener')
    .on(
      'postgres_changes',
      { event: 'INSERT', schema: 'public', table: 'approved_guilds' },
      async (payload) => {
        try {
          const newRow = payload.new;
          console.log('[VTCRoles] Realtime INSERT on approved_guilds detected:', newRow?.guild_name, newRow?.guild_id);

          if (!newRow || !newRow.guild_name) return;

          const guild = getPrimaryGuild(client);
          if (!guild) {
            console.warn('[VTCRoles] Primary guild not found for new role creation.');
            return;
          }

          const createdRole = await createRoleForApprovedGuild(guild, newRow);
          if (createdRole) {
            console.log(`[VTCRoles] Role "${createdRole.name}" created from Realtime event. Updating roles.js...`);
            await syncServerConfig(client);
          }
        } catch (err) {
          console.error('[VTCRoles] Error handling Realtime insert on approved_guilds:', err);
        }
      }
    )
    .subscribe((status, err) => {
      if (err) {
        console.error('[VTCRoles] Realtime subscription error:', err);
      } else {
        console.log(`[VTCRoles] Realtime subscription status: ${status}`);
      }
    });

  return channel;
}

/**
 * Schedules daily execution of syncAllMembersVtcStatus at 12:00:00 AM GMT (UTC+0).
 *
 * @param {import('discord.js').Client} client
 */
function scheduleDailyVtcSync(client) {
  const scheduleNext = () => {
    const now = new Date();
    // Calculate next 00:00:00 GMT (UTC)
    const nextUtc = new Date(Date.UTC(
      now.getUTCFullYear(),
      now.getUTCMonth(),
      now.getUTCDate() + 1,
      0, 0, 0, 0
    ));

    const delayMs = nextUtc.getTime() - now.getTime();
    console.log(`[VTCSync] Next daily sync scheduled for ${nextUtc.toISOString()} (in ${Math.round(delayMs / 1000 / 60)} minutes).`);

    setTimeout(async () => {
      try {
        console.log('[VTCSync] Executing scheduled 12:00 AM GMT member sync...');
        await syncAllMembersVtcStatus(client);
      } catch (err) {
        console.error('[VTCSync] Error during scheduled sync:', err);
      } finally {
        scheduleNext();
      }
    }, delayMs);
  };

  scheduleNext();
}

module.exports = {
  processMemberVtcStatus,
  syncAllMembersVtcStatus,
  createRoleForApprovedGuild,
  ensureAllApprovedGuildRolesExist,
  listenToApprovedGuilds,
  scheduleDailyVtcSync
};
