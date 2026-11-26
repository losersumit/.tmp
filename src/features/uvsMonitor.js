const { uvsSupabase } = require('../database/supabase');
const roles = require('../config/roles');
const channels = require('../config/channels');

const UVS_GUIDE_WEBHOOK_ID = '1560271816470171699';
const UVS_GUIDE_CHANNEL_ID = '1560207719670218752';
const UVS_GUIDE_MESSAGE_ID = '1560272211024150560';
const CHECK_INTERVAL_MS = 5 * 60 * 1000; // 5 minutes
const DOWN_THRESHOLD_MS = 6 * 60 * 1000; // 6 minutes (1 missed 5-min ping + grace)

let isCurrentlyDown = false;
let cachedGuideMessageId = UVS_GUIDE_MESSAGE_ID;

async function updateGuideStatus(client, isDown) {
  try {
    const webhook = await client.fetchWebhook(UVS_GUIDE_WEBHOOK_ID).catch(() => null);
    if (!webhook || !webhook.channelId) {
      console.warn('[UVS Monitor] Could not fetch guide webhook:', UVS_GUIDE_WEBHOOK_ID);
      return;
    }

    const channelId = webhook.channelId || UVS_GUIDE_CHANNEL_ID;
    const channel = await client.channels.fetch(channelId).catch(() => null);
    if (!channel) return;

    let targetMsg = null;
    if (cachedGuideMessageId) {
      targetMsg = await channel.messages.fetch(cachedGuideMessageId).catch(() => null);
    }

    if (!targetMsg) {
      const messages = await channel.messages.fetch({ limit: 25 }).catch(() => null);
      if (messages) {
        targetMsg = messages.find(m => m.webhookId === UVS_GUIDE_WEBHOOK_ID);
        if (targetMsg) cachedGuideMessageId = targetMsg.id;
      }
    }

    if (!targetMsg || !Array.isArray(targetMsg.components) || targetMsg.components.length === 0) {
      console.warn('[UVS Monitor] Could not locate UVS Guide Components v2 message.');
      return;
    }

    // Clone raw component JSON and update the last container (UVS System Status)
    const updatedComponents = targetMsg.components.map(c => (typeof c.toJSON === 'function' ? c.toJSON() : { ...c }));
    const lastIdx = updatedComponents.length - 1;
    const statusText = isDown
      ? '### 💻 UVS System Status \n🔴 Down — System is currently experiencing downtime.'
      : '### 💻 UVS System Status \n🟢 Operational — All systems are running normally.';

    updatedComponents[lastIdx] = {
      type: 17,
      accent_color: isDown ? 15158332 : 1704111,
      components: [
        { type: 10, content: statusText },
        { type: 14 }
      ]
    };

    await webhook.editMessage(targetMsg.id, {
      components: updatedComponents,
      flags: 32768
    });
    console.log(`[UVS Monitor] Updated guide status to: ${isDown ? 'DOWN' : 'OPERATIONAL'}`);
  } catch (err) {
    console.error('[UVS Monitor] Failed to update guide status:', err.message);
  }
}

async function alertPartners(client, isDown) {
  const alertChannelId = channels.TEXT?.UVS_LOGS || channels.CABIN;
  if (!alertChannelId) return;

  try {
    const channel = await client.channels.fetch(alertChannelId).catch(() => null);
    if (!channel) return;

    const partnerPing = roles.PARTNER ? `<@&${roles.PARTNER}>` : '@Partner';
    if (isDown) {
      await channel.send(
        `${partnerPing} 🚨 **UVS System Alert:** UVS has not responded to the 5-minute heartbeat check and appears to be **DOWN**. Please investigate.`
      );
    } else {
      await channel.send(
        `✅ **UVS System Recovered:** UVS is back **online** and responding to heartbeats normally.`
      );
    }
  } catch (err) {
    console.error('[UVS Monitor] Failed to send partner alert:', err.message);
  }
}

async function checkUvsHeartbeat(client) {
  try {
    const { data, error } = await uvsSupabase
      .from('bot_heartbeats')
      .select('last_ping')
      .eq('bot_name', 'uvs')
      .maybeSingle();

    if (error) {
      console.warn('[UVS Monitor] Error querying bot_heartbeats:', error.message);
      return;
    }

    const lastPingMs = data?.last_ping ? new Date(data.last_ping).getTime() : 0;
    const ageMs = Date.now() - lastPingMs;
    const shouldBeDown = !lastPingMs || ageMs > DOWN_THRESHOLD_MS;

    if (shouldBeDown && !isCurrentlyDown) {
      isCurrentlyDown = true;
      console.warn(`[UVS Monitor] UVS heartbeat missed (last ping ${Math.round(ageMs / 1000)}s ago). Marking DOWN.`);
      await updateGuideStatus(client, true);
      await alertPartners(client, true);
    } else if (!shouldBeDown && isCurrentlyDown) {
      isCurrentlyDown = false;
      console.log('[UVS Monitor] UVS heartbeat resumed. Marking OPERATIONAL.');
      await updateGuideStatus(client, false);
      await alertPartners(client, false);
    }
  } catch (err) {
    console.error('[UVS Monitor] Heartbeat check error:', err.message);
  }
}

function startUvsMonitor(client) {
  // Initial check 30s after startup, then every 5 minutes
  setTimeout(() => checkUvsHeartbeat(client), 30 * 1000);
  setInterval(() => checkUvsHeartbeat(client), CHECK_INTERVAL_MS);
  console.log('📡 [UVS Monitor] Started 5-minute UVS heartbeat monitor.');
}

module.exports = { startUvsMonitor, checkUvsHeartbeat };
