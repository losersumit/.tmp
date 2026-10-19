/**
 * Moderation Storage System — Supabase
 *
 * Handles warning persistence for AI moderation.
 * Uses the shared Supabase client from src/database/supabase.js.
 * Table: mod_warnings
 */

const { supabase } = require('../database/supabase');
const config = require('../config');

const { actionThresholds } = config.moderation.warnings;

/**
 * Add a warning for a user and determine if an automated action should be taken.
 *
 * @param {string} userId - Discord user ID
 * @param {string} reason - Reason for the warning
 * @param {string} severity - 'low' | 'medium' | 'high'
 * @returns {Promise<{ userData: { count: number }, recommendedAction: string|null }>}
 */
async function addWarning(userId, reason, severity) {
  try {
    const { error: insertError } = await supabase
      .from('mod_warnings')
      .insert({
        user_id: userId,
        reason,
        severity,
        moderator_id: 'AI'
      });

    if (insertError) {
      console.error('[ModerationStorage] Error inserting warning:', insertError.message);
    }

    // Fetch total warning count for this user
    const warningData = await getUserWarnings(userId);
    const warningCount = warningData.count;

    const recommendedAction = determineAction(warningCount);

    console.log(`[ModerationStorage] Warning added for user ${userId}. Total: ${warningCount}. Action: ${recommendedAction || 'none'}`);

    return {
      userData: { count: warningCount },
      recommendedAction
    };
  } catch (err) {
    console.error('[ModerationStorage] Exception in addWarning:', err.message);
    return { userData: { count: 1 }, recommendedAction: null };
  }
}

/**
 * Fetch all warnings for a user from Supabase.
 *
 * @param {string} userId - Discord user ID
 * @returns {Promise<{ count: number, warnings: Array, lastWarning: string|null }>}
 */
async function getUserWarnings(userId) {
  try {
    const { count, data, error } = await supabase
      .from('mod_warnings')
      .select('*', { count: 'exact' })
      .eq('user_id', userId)
      .order('created_at', { ascending: false })
      .limit(20);

    if (error) {
      console.error('[ModerationStorage] Error fetching warnings:', error.message);
      return { count: 0, warnings: [], lastWarning: null };
    }

    return {
      count: count || 0,
      warnings: data || [],
      lastWarning: data?.length > 0 ? data[0].created_at : null
    };
  } catch (err) {
    console.error('[ModerationStorage] Exception in getUserWarnings:', err.message);
    return { count: 0, warnings: [], lastWarning: null };
  }
}

/**
 * Reset all warnings for a user.
 *
 * @param {string} userId - Discord user ID
 */
async function resetWarnings(userId) {
  try {
    const { error } = await supabase
      .from('mod_warnings')
      .delete()
      .eq('user_id', userId);

    if (error) throw error;
    console.log(`[ModerationStorage] Warnings reset for user ${userId}`);
    return true;
  } catch (err) {
    console.error('[ModerationStorage] Error resetting warnings:', err.message);
    return false;
  }
}

/**
 * Determine what automated action to take based on warning count.
 *
 * @param {number} warningCount
 * @returns {string|null}
 */
function determineAction(warningCount) {
  if (warningCount >= actionThresholds.ban)         return 'ban';
  if (warningCount >= actionThresholds.kick)        return 'kick';
  if (warningCount >= actionThresholds.timeout24h)  return 'timeout_24h';
  if (warningCount >= actionThresholds.timeout1h)   return 'timeout_1h';
  return null;
}

module.exports = { addWarning, getUserWarnings, resetWarnings };
