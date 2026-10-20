const { SlashCommandBuilder, PermissionFlagsBits, ChannelType, MessageFlags } = require('discord.js');
const config = require('../config');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('setwh')
    .setDescription('Get or Create a Webhook for the current channel or thread/forum post')
    .addChannelOption(option =>
      option.setName('channel')
        .setDescription('The channel or thread to get/create the webhook in (optional)')
        .setRequired(false)
        .addChannelTypes(
          ChannelType.GuildText,
          ChannelType.GuildAnnouncement,
          ChannelType.PublicThread,
          ChannelType.PrivateThread,
          ChannelType.AnnouncementThread,
          ChannelType.GuildVoice,
          ChannelType.GuildForum
        )
    ),

  async execute(interaction) {
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });

    const partnerRoleId = config.roles?.PARTNER;
    const isPartner = Boolean(
      partnerRoleId &&
      interaction.member?.roles?.cache?.has(partnerRoleId)
    );

    if (!isPartner) {
      return interaction.editReply({
        content: '❌ You do not have permission to use this command. Only Partners can use this.'
      });
    }

    const targetChannel = interaction.options.getChannel('channel') || interaction.channel;
    if (!targetChannel) {
      return interaction.editReply({
        content: '❌ Unable to determine the target channel.'
      });
    }

    try {
      const isThreadOrPost = targetChannel.isThread && targetChannel.isThread();
      const parentChannel = isThreadOrPost ? targetChannel.parent : targetChannel;

      if (!parentChannel || typeof parentChannel.fetchWebhooks !== 'function') {
        return interaction.editReply({
          content: `❌ Webhooks are not supported in <#${targetChannel.id}>.`
        });
      }

      // Fetch webhooks on the parent channel
      const webhooks = await parentChannel.fetchWebhooks();

      // Find an existing webhook owned by this bot client
      let webhook = webhooks.find(wh => wh.owner?.id === interaction.client.user.id);

      const webhookName = 'ᴛᴍᴘ ᴇ-ᴄʟᴜʙ';
      let isNew = false;

      if (!webhook) {
        webhook = await parentChannel.createWebhook({
          name: webhookName,
          avatar: interaction.client.user.displayAvatarURL()
        });
        isNew = true;
      }

      // If in a thread or forum post, append ?thread_id=...
      const finalWebhookUrl = isThreadOrPost
        ? `${webhook.url}?thread_id=${targetChannel.id}`
        : webhook.url;

      if (isNew) {
        return interaction.editReply({
          content: `✅ **Webhook Created Successfully for <#${targetChannel.id}>!**\n\n**Name:** \`${webhookName}\`\n${isThreadOrPost ? `*(Thread/Post: <#${targetChannel.id}> in parent <#${parentChannel.id}>)*\n` : ''}\n**Webhook URL:**\n\`${finalWebhookUrl}\``
        });
      }

      return interaction.editReply({
        content: `✅ **Webhook Already Exists for <#${targetChannel.id}>!**\n\nI found an existing webhook created by me.\n\n**Name:** \`${webhook.name}\`\n${isThreadOrPost ? `*(Thread/Post: <#${targetChannel.id}> in parent <#${parentChannel.id}>)*\n` : ''}\n**Webhook URL:**\n\`${finalWebhookUrl}\``
      });

    } catch (error) {
      console.error('[setwh] Error creating or fetching webhook:', error);
      return interaction.editReply({
        content: `❌ Failed to create/retrieve webhook in <#${targetChannel.id}>: ${error.message}`
      });
    }
  }
};
