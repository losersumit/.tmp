const { EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, PermissionFlagsBits } = require('discord.js');
const { supabase } = require('../database/supabase');
const { resolveAttachmentFromLink } = require('../utils/discordUtils');
const { generateTaskTitle } = require('../utils/aiUtils');
const config = require('../config');

/**
 * Check if the member has admin/mod permissions for todo operations.
 * Allows Discord Administrators or members with designated roles.
 */
function hasAdminPermission(member) {
  if (!member) return false;
  if (member.permissions && member.permissions.has(PermissionFlagsBits.Administrator)) {
    return true;
  }
  return config.discord.adminRoleIds.some(roleId => member.roles.cache.has(roleId));
}

function formatStatus(status) {
  switch (status) {
    case 'Not reviewed yet':
      return '⏳ Not reviewed yet';
    case 'Working':
      return '⚙️ Working';
    case 'Done':
      return '✅ Done';
    case 'Rejected':
      return '❌ Rejected';
    default:
      return `❓ ${status}`;
  }
}

/**
 * Generate paginated todo list embed
 */
async function generateTodoEmbed(page = 0) {
  const limit = 5;
  const offset = page * limit;

  const { data: allTodos, error } = await supabase
    .from('todos')
    .select('*');

  if (error) {
    console.error('Database error in generateTodoEmbed:', error);
    throw error;
  }

  const priorityMap = {
    'Not reviewed yet': 1,
    'Working': 2,
    'Done': 3,
    'Rejected': 4
  };

  const sortedTodos = (allTodos || []).sort((a, b) => {
    const priorityA = priorityMap[a.status] || 5;
    const priorityB = priorityMap[b.status] || 5;
    if (priorityA !== priorityB) {
      return priorityA - priorityB;
    }
    return Number(b.id) - Number(a.id);
  });

  const count = sortedTodos.length;
  const todos = sortedTodos.slice(offset, offset + limit);

  const embed = new EmbedBuilder()
    .setColor(0x5865F2)
    .setTitle('📋 Command Cabin Tasks')
    .setDescription('Below are registered tasks. Use `◀️ Previous` and `Next ▶️` buttons to navigate.')
    .setTimestamp();

  if (!todos || todos.length === 0) {
    embed.setDescription('❌ There are no tasks recorded in the todo list.');

    const prevButton = new ButtonBuilder()
      .setCustomId(`todo_prev:${page - 1}`)
      .setLabel('◀️ Previous')
      .setStyle(ButtonStyle.Secondary)
      .setDisabled(true);

    const nextButton = new ButtonBuilder()
      .setCustomId(`todo_next:${page + 1}`)
      .setLabel('Next ▶️')
      .setStyle(ButtonStyle.Secondary)
      .setDisabled(true);

    const row = new ActionRowBuilder().addComponents(prevButton, nextButton);
    return { embeds: [embed], components: [row] };
  }

  let descriptionText = '';
  for (const todo of todos) {
    descriptionText += `🔹 **#${todo.id}** — ${todo.title || todo.task}\n`;
    descriptionText += `*Status: ${formatStatus(todo.status)}*\n\n`;
  }

  embed.setDescription(descriptionText.trim());
  embed.setFooter({ text: `Page ${page + 1} of ${Math.max(1, Math.ceil(count / limit))} | Total Tasks: ${count}` });

  const prevButton = new ButtonBuilder()
    .setCustomId(`todo_prev:${page - 1}`)
    .setLabel('◀️ Previous')
    .setStyle(ButtonStyle.Primary)
    .setDisabled(page <= 0);

  const hasMore = count > (page + 1) * limit;
  const nextButton = new ButtonBuilder()
    .setCustomId(`todo_next:${page + 1}`)
    .setLabel('Next ▶️')
    .setStyle(ButtonStyle.Primary)
    .setDisabled(!hasMore);

  const row = new ActionRowBuilder().addComponents(prevButton, nextButton);

  return { embeds: [embed], components: [row] };
}

/**
 * Handle pagination button clicks
 */
async function handleTodoPagination(interaction) {
  const allowedChannelId = config.discord.cabinChannelId;
  if (allowedChannelId && interaction.channelId !== allowedChannelId) {
    return interaction.reply({
      content: `❌ This interaction is only allowed in <#${allowedChannelId}>.`,
      ephemeral: true
    });
  }

  const parts = interaction.customId.split(':');
  const page = parseInt(parts[1], 10) || 0;

  try {
    const response = await generateTodoEmbed(page);
    await interaction.update(response);
  } catch (err) {
    console.error('Error in handleTodoPagination:', err);
    await interaction.reply({ content: '❌ Failed to paginate todo list.', ephemeral: true });
  }
}

/**
 * Handle !todo commands
 */
async function handleTodoCommand(message, args, client) {
  const allowedChannelId = config.discord.cabinChannelId;
  if (allowedChannelId && message.channelId !== allowedChannelId) {
    return message.reply(`❌ The \`!todo\` command can only be used in <#${allowedChannelId}>.`);
  }

  const subCommand = args[0]?.toLowerCase();

  // !todo or !todo list
  if (!subCommand || subCommand === 'list') {
    try {
      const response = await generateTodoEmbed(0);
      await message.reply(response);
    } catch (err) {
      console.error('Error fetching todos:', err);
      await message.reply('❌ Failed to fetch the todo list.');
    }
    return;
  }

  // !todo help
  if (subCommand === 'help') {
    const embed = new EmbedBuilder()
      .setColor(0x2F3136)
      .setTitle('📋 Todo List Command System')
      .setDescription('Manage commands and tasks.')
      .addFields(
        {
          name: '⚡ Public Commands (Anyone)',
          value:
            '`!todo` / `!todo list` - Show registered tasks (paginated).\n' +
            '`!todo add <text>` - Register a new task. You can optionally upload/attach an image with this message.\n' +
            '`!todo view <number>` - View detailed information for a task.\n' +
            '`!todo help` - Show this menu.'
        },
        {
          name: '🛡️ Admin Commands',
          value:
            '`!todo working <number>` - Set a task\'s status to Working.\n' +
            '`!todo done <number>` - Set a task\'s status to Done (pings creator).\n' +
            '`!todo reject <number>` - Set a task\'s status to Rejected.\n' +
            '`!todo delete <number>` - Permanently delete a task.'
        }
      )
      .setTimestamp();

    await message.reply({ embeds: [embed] });
    return;
  }

  // !todo view <number>
  if (subCommand === 'view') {
    return handleTodoView(message, args, client);
  }

  // !todo add <text>
  if (subCommand === 'add') {
    const taskText = args.slice(1).join(' ').trim();
    if (!taskText) {
      return message.reply('❌ Usage: `!todo add <task description>` (you can also upload an image alongside the command).');
    }

    const attachment = message.attachments.first();
    const imageUrl = attachment ? `https://discord.com/channels/${message.guild.id}/${message.channel.id}/${message.id}` : null;
    const initiatorName = message.member?.displayName || message.author.username;
    const initiatorId = message.author.id;

    try {
      const titleText = await generateTaskTitle(taskText);

      const { data: todo, error } = await supabase
        .from('todos')
        .insert({
          task: taskText,
          title: titleText,
          created_by: initiatorName,
          created_by_id: initiatorId,
          image_url: imageUrl,
          status: 'Not reviewed yet'
        })
        .select()
        .single();

      if (error) throw error;

      await message.react(config.discord.successEmoji).catch(() => message.react('✅')).catch(() => {});
    } catch (err) {
      console.error('Error adding todo:', err);
      await message.reply('❌ Failed to add the task to the todo list.');
    }
    return;
  }

  // Admin commands: working, done, reject, delete
  const adminCommands = ['working', 'done', 'reject', 'delete'];
  if (adminCommands.includes(subCommand)) {
    if (!hasAdminPermission(message.member)) {
      return message.reply('❌ You do not have permission to use admin todo commands.');
    }

    const taskNumber = parseInt(args[1], 10);
    if (isNaN(taskNumber)) {
      return message.reply(`❌ Usage: \`!todo ${subCommand} <task_number>\`. Example: \`!todo ${subCommand} 5\``);
    }

    try {
      if (subCommand === 'delete') {
        const { data: deletedTodo, error } = await supabase
          .from('todos')
          .delete()
          .eq('id', taskNumber)
          .select()
          .single();

        if (error || !deletedTodo) {
          return message.reply(`❌ Task **#${taskNumber}** not found or already deleted.`);
        }

        await message.react(config.discord.successEmoji).catch(() => message.react('✅')).catch(() => {});
      } else {
        let statusString = 'Not reviewed yet';
        if (subCommand === 'working') statusString = 'Working';
        else if (subCommand === 'done') statusString = 'Done';
        else if (subCommand === 'reject') statusString = 'Rejected';

        const { data: updatedTodo, error } = await supabase
          .from('todos')
          .update({ status: statusString })
          .eq('id', taskNumber)
          .select()
          .single();

        if (error || !updatedTodo) {
          return message.reply(`❌ Task **#${taskNumber}** not found.`);
        }

        await message.react(config.discord.successEmoji).catch(() => message.react('✅')).catch(() => {});

        // Done status mentions the original creator
        if (subCommand === 'done') {
          const targetUserId = updatedTodo.created_by_id;
          const taskTitle = updatedTodo.title || updatedTodo.task;
          await message.channel.send(`<@${targetUserId}>, your task **#${taskNumber}** ("${taskTitle}") is done!`);
        }
      }
    } catch (err) {
      console.error(`Error executing todo ${subCommand}:`, err);
      await message.reply(`❌ Failed to execute todo ${subCommand} action.`);
    }
    return;
  }

  await message.reply('❌ Unknown todo subcommand. Use `!todo help` to see available commands.');
}

/**
 * Handle !todo view <taskNumber>
 */
async function handleTodoView(message, args, client) {
  const allowedChannelId = config.discord.cabinChannelId;
  if (allowedChannelId && message.channelId !== allowedChannelId) {
    return message.reply(`❌ The \`!todo\` command can only be used in <#${allowedChannelId}>.`);
  }

  const taskNumber = parseInt(args[1], 10);
  if (isNaN(taskNumber)) {
    return message.reply('❌ Usage: `!todo view <task_number>`. Example: `!todo view 5`');
  }

  try {
    const { data: todo, error } = await supabase
      .from('todos')
      .select('*')
      .eq('id', taskNumber)
      .single();

    if (error || !todo) {
      return message.reply(`❌ Task **#${taskNumber}** not found.`);
    }

    const embed = new EmbedBuilder()
      .setColor(
        todo.status === 'Done' ? 0x2ECC71 :
        todo.status === 'Rejected' ? 0xE74C3C :
        todo.status === 'Working' ? 0xF1C40F : 0x5865F2
      )
      .setTitle(`📋 Task Details — #${todo.id}`)
      .addFields(
        { name: '📌 Title', value: todo.title || 'No Title' },
        { name: '📝 Description', value: todo.task || 'No Description' },
        { name: '👤 Initiated By', value: `${todo.created_by} (<@${todo.created_by_id}>)`, inline: true },
        { name: 'Status', value: formatStatus(todo.status), inline: true },
        { name: '📅 Date Added', value: `<t:${Math.floor(new Date(todo.created_at).getTime() / 1000)}:F>`, inline: false }
      )
      .setTimestamp();

    if (todo.image_url) {
      let freshImageUrl = null;
      if (todo.image_url.includes('discord.com/channels/')) {
        const resolved = await resolveAttachmentFromLink(client, todo.image_url);
        if (resolved) {
          freshImageUrl = resolved.url;
        }
      } else {
        freshImageUrl = todo.image_url;
      }

      if (freshImageUrl) {
        embed.setImage(freshImageUrl);
      }
    }

    await message.reply({ embeds: [embed] });
  } catch (err) {
    console.error('Error viewing task:', err);
    await message.reply('❌ Failed to retrieve task details.');
  }
}

module.exports = {
  handleTodoCommand,
  handleTodoPagination,
  handleTodoView,
  generateTodoEmbed
};
