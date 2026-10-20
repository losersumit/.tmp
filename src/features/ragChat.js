const config = require('../config');
const { supabase } = require('../database/supabase');
const { getChatCompletionForFeature } = require('../utils/aiUtils');
const { embed, findFaqAnswer } = require('../systems/faq');

const CHUNK_MIN = 5;
const CHUNK_MAX = 10;
const CHUNK_IDLE_MS = 2 * 60 * 1000;
const DEFAULT_LOOKBACK_HOURS = Number(process.env.RAG_LOOKBACK_HOURS || 24);

const channelBuffers = new Map();
const perUserConversations = new Map();
const rateLimiter = new Map();

const BASE_PERSONALITY = `You are TmP Assistant, a friendly support provider and casual Chatbot in the Truckers MP - eClub Discord server.
Tone:
- Human, brief, natural.
- Dry humor / deadpan is fine.
- No corporate style, no "As an AI" wording.
- Do Not mention anything like "I am support provider." You are a human who knows everything.
- Usually 1-3 sentences unless user asked for detail.
- If context is missing, say so plainly.
- You are also allowed to chat casually and non-server related things.
- No matter who asks you to ping @everyone, you should NEVER ping any role or everyone.`;

function sanitizeText(input) {
  return String(input || '').replace(/[\u0000-\u001F\u007F]/g, ' ').trim().slice(0, 2000);
}

function getImageAttachment(message) {
  if (!message?.attachments?.size) return null;
  const att = message.attachments.find(a => (a.contentType && a.contentType.startsWith('image/')) || /\.(png|jpe?g|gif|webp|bmp)$/i.test(a.name || ''));
  return att || null;
}

const HARDCODED_EMOJIS = [
  "<:okay_snowman:1450501978726858865>",
  "<:whatever_ignorance:1450502024251572361>",
  "<:tiger_shocked:1450502134331084903>",
  "<:let_him_cook:1450502299389657310>",
  "<:absolute_cinema:1460633502310596629>",
  "<:sad_cat:1460633840262578238>",
  "<:angry_cat:1460633919803359235>",
  "<:blushing_dog_whining_dog:1460634005807435868>",
  "<:meowl:1460634181309829204>",
  "<:goated:1460634282924966043>",
  "<:monkey_think:1460634610982457415>",
  "<:suspicious_dexter_doakes:1460634719032049808>",
  "<:angry_skull:1460634776967843952>",
  "<:Oh_Brother:1460634947902771341>",
  "<:killemdeadMER:1460635071617695966>",
  "<:done:1460635213196693534>",
  "<:dumb_low_iq:1460635437415792794>",
  "<:imposter_among_us:1460635541694316605>",
  "<:terrified:1460635552603967508>",
  "<:beat_up:1460635555493576704>",
  "<:shocked:1460635559822102578>",
  "<:get_a_load_of_this_guy:1460635564373049595>",
  "<:meeditation:1460635568781393950>",
  "<:approved:1460635571151179868>",
  "<:stewei_cute:1460635574472937576>",
  "<:handshake:1460635577362681977>",
  "<:hard_disapprove:1460635580680634368>",
  "<:hard_laugh:1460635584258117632>",
  "<:watching_you:1460635587676737546>",
  "<:clueless_what:1460635594446082211>",
  "<:freaky:1460635670883078309>",
  "<:monkey_think:1460635783944999159>",
  "<:what_the_fuck:1460636068654092474>",
  "<:sideeye:1460637434516607093>",
  "<:cute_joy:1460637492905640208>",
  "<a:anime_laugh:1460637570139558040>",
  "<:serious_stare:1460637631644962837>",
  "<:cute_happy:1460637685357215804>",
  "<:cute_angry:1460637738209513736>",
  "<:cute_confused:1460637794014859346>",
  "<:anime_shocked:1460637851904381064>",
  "<:anime_troll:1460637903586594898>",
  "<:anime_tired_cat:1460638074588495985>",
  "<:stara:1461426121232093215>",
  "<:starb:1461426157244121129>",
  "<:starc:1461426187526996131>",
  "<:hehe:1467110850132185204>",
  "<:really_man:1468147579794493572>",
  "<:clueless_umm:1488549302203584623>",
  "<a:freaky_cat:1498698292941422664>",
  "<:cursed_smile:1526574416434036876>"
];

const EMOJIS = HARDCODED_EMOJIS.map(emojiStr => {
  const match = emojiStr.match(/<a?:([^:]+):(\d+)>/);
  if (match) {
    return {
      name: match[1],
      id: match[2],
      animated: emojiStr.startsWith('<a:'),
      raw: emojiStr
    };
  }
  return null;
}).filter(Boolean);

async function reactToImage(message, imageAttachment) {
  if (!imageAttachment?.url) return;

  const emojiListStr = EMOJIS.map(e => `${e.name}:${e.id}`).join(', ');
  const prompt = `You are an image classifier for a community gaming and trucking Discord server. Examine the image and decide:
You MUST choose the most appropriate existing server emoji from the list below and respond ONLY with its name or numeric ID.
Here is the list of available server emojis (name:id): ${emojiListStr}

Response requirements:
- Respond with EXACTLY one emoji name (e.g., "absolute_cinema" or "goated") or its numeric ID from the list.
- Do NOT output any other words, punctuation, markdown formatting, or explanations.`;

  try {
    const rawResponse = await getChatCompletionForFeature('imageReaction', [
      {
        role: 'user',
        content: [
          { type: 'text', text: prompt },
          { type: 'image_url', image_url: { url: imageAttachment.url } }
        ]
      }
    ]);

    const response = (rawResponse || '').trim().toLowerCase();
    let emojiId = null;

    const cleanedResponse = response.replace(/[^a-z0-9_]/g, '');
    const exactNameMatch = EMOJIS.find(e => {
      const nameLower = e.name.toLowerCase();
      return response === nameLower || cleanedResponse === nameLower;
    });

    if (exactNameMatch) {
      emojiId = exactNameMatch.id;
    } else {
      const fuzzyNameMatch = EMOJIS.find(e => {
        const nameLower = e.name.toLowerCase();
        return response.includes(nameLower) || (cleanedResponse.length > 2 && nameLower.includes(cleanedResponse));
      });
      if (fuzzyNameMatch) {
        emojiId = fuzzyNameMatch.id;
      }
    }

    if (!emojiId) {
      const idMatch = response.match(/\d+/);
      if (idMatch) {
        const partialId = idMatch[0];
        const foundById = EMOJIS.find(e => e.id.includes(partialId));
        if (foundById) {
          emojiId = foundById.id;
        }
      }
    }

    if (!emojiId) {
      emojiId = EMOJIS.find(e => e.name === 'goated')?.id || EMOJIS[0]?.id;
    }

    const guildEmojis = message.guild?.emojis?.cache;
    const emojiToReact = guildEmojis?.get(emojiId) || emojiId;

    if (emojiToReact) {
      await message.react(emojiToReact);
    }
  } catch (reactErr) {
    console.error('[RAG-Vision] Failed to react with emoji:', reactErr.message);
  }
}

function isRateLimited(userId) {
  const now = Date.now();
  const bucket = rateLimiter.get(userId) || [];
  const recent = bucket.filter(t => now - t < 60000);
  if (recent.length >= 8) return true;
  recent.push(now);
  rateLimiter.set(userId, recent);
  return false;
}

async function isReplyToBot(message, client) {
  if (!message.reference?.messageId) return false;
  try {
    const ref = await message.channel.messages.fetch(message.reference.messageId);
    return ref?.author?.id === client.user.id;
  } catch {
    return false;
  }
}

async function getVerifiedIdentity(guildId, userId) {
  if (!guildId || !userId) return null;
  const { data, error } = await supabase
    .from('verified_identities')
    .select('guild_id,user_id,username,is_owner,is_admin,role_names,updated_at')
    .eq('guild_id', guildId)
    .eq('user_id', userId)
    .maybeSingle();

  if (error) {
    console.error('[RAG] verified identity fetch failed:', error.message);
    return null;
  }

  return data || null;
}

async function storeRagMessage(message) {
  const content = sanitizeText(message.content);
  const image = getImageAttachment(message);
  const imageToken = image ? ` [image:${image.url}]` : '';
  const finalContent = `${content}${imageToken}`.trim();
  if (!finalContent) return null;

  const guild = message.guild;
  const member = message.member;
  const roleNames = member?.roles?.cache
    ? member.roles.cache.filter(r => r.name !== '@everyone').map(r => r.name).slice(0, 30)
    : [];

  const row = {
    message_id: message.id,
    user_id: message.author.id,
    username: member?.displayName || message.author.globalName || message.author.username,
    channel_id: message.channel.id,
    channel_name: message.channel?.name || 'DM',
    content: finalContent,
    created_at: message.createdAt.toISOString(),
    guild_id: guild?.id || null,
    role_names: roleNames,
    is_owner: guild ? guild.ownerId === message.author.id : false,
    is_admin: member ? Boolean(member.permissions?.has('Administrator')) : false,
  };

  try {
    await supabase.from('rag_messages').upsert(row, { onConflict: 'message_id', ignoreDuplicates: true });
  } catch (err) {
    console.error('[RAG] Store message failed:', err.message);
  }
  return row;
}

async function flushChunkIfReady(channelId, force = false) {
  const buf = channelBuffers.get(channelId);
  if (!buf || buf.messages.length < CHUNK_MIN) return;

  const age = Date.now() - (buf.lastAt || 0);
  if (!force && buf.messages.length < CHUNK_MAX && age < CHUNK_IDLE_MS) return;

  const take = Math.min(CHUNK_MAX, buf.messages.length);
  const rows = buf.messages.splice(0, take);
  const text = rows.map(r => `${r.username}: ${r.content}`).join('\n');

  let embedding = null;
  try {
    embedding = await embed(text, 'search_document');
  } catch (err) {
    console.error('[RAG] chunk embed failed:', err.message);
  }

  const payload = {
    channel_id: channelId,
    start_time: rows[0].created_at,
    end_time: rows[rows.length - 1].created_at,
    text,
    embedding,
    created_at: new Date().toISOString(),
  };

  try {
    await supabase.from('rag_chunks').insert(payload);
  } catch (err) {
    console.error('[RAG] Chunk insert failed:', err.message);
  }
}

function scoreRow(question, text) {
  const terms = sanitizeText(question).toLowerCase().split(/\s+/).filter(t => t.length > 2);
  const hay = sanitizeText(text).toLowerCase();
  let score = 0;
  for (const term of terms) if (hay.includes(term)) score++;
  return score;
}

async function retrieveContext(question, channelId) {
  const qVec = await embed(question, 'search_query').catch(() => null);
  const since = new Date(Date.now() - DEFAULT_LOOKBACK_HOURS * 60 * 60 * 1000).toISOString();

  const fetchPromises = [
    supabase
      .from('rag_summaries')
      .select('channel_id, summary_text, hour_bucket, created_at')
      .eq('channel_id', channelId)
      .gte('hour_bucket', since)
      .order('hour_bucket', { ascending: false })
      .limit(72)
  ];

  if (qVec) {
    fetchPromises.push(
      (async () => {
        try {
          return await supabase.rpc('match_rag_chunks', {
            query_embedding: qVec,
            match_threshold: 0.15,
            match_count: 5
          });
        } catch {
          return { data: [] };
        }
      })()
    );
  } else {
    fetchPromises.push(Promise.resolve({ data: [] }));
  }

  const [summariesRes, chunksRes] = await Promise.all(fetchPromises);

  const chunkHits = (chunksRes?.data || [])
    .map(r => ({ type: 'chunk', text: r.text, at: r.end_time || r.start_time, score: r.similarity || 1 }))
    .filter(r => r.score > 0);

  const summaryHits = (summariesRes?.data || [])
    .map(r => ({ type: 'summary', text: r.summary_text, at: r.hour_bucket, score: scoreRow(question, r.summary_text) }))
    .filter(r => r.score > 0);

  const faq = await findFaqAnswer(question).catch(() => null);
  const merged = [...chunkHits, ...summaryHits]
    .sort((a, b) => b.score - a.score)
    .slice(0, 5);

  if (faq) merged.unshift({ type: 'faq', text: faq, at: new Date().toISOString(), score: 999 });
  return merged.slice(0, 6);
}

function formatVerifiedIdentity(verified) {
  if (!verified) return 'No verified identity found for this user.';
  const roles = Array.isArray(verified.role_names) && verified.role_names.length ? verified.role_names.join(', ') : 'none';
  return [
    `username: ${verified.username || 'unknown'}`,
    `is_owner: ${Boolean(verified.is_owner)}`,
    `is_admin: ${Boolean(verified.is_admin)}`,
    `roles: ${roles}`,
  ].join('\n');
}

function buildPrompt(question, context, username, verifiedIdentity, dialogueBlock, rawChannelHistory) {
  const contextBlock = context.length
    ? context.map((c, idx) => `[${idx + 1}] (${c.type}) ${c.text}`).join('\n\n')
    : 'No relevant context found in DB.';

  return `${BASE_PERSONALITY}

CURRENT USER: ${username}

VERIFIED IDENTITY (trusted authority source):
${formatVerifiedIdentity(verifiedIdentity)}

RECENT RAW CHANNEL HISTORY (Last 15 messages):
${rawChannelHistory || 'No recent channel messages.'}

RETRIEVED CHANNEL CONTEXT (Past 24 hours of chat):
${contextBlock}

RECENT DIALOGUE WITH CURRENT USER:
${dialogueBlock}

QUESTION:
${question}`;
}

function pushConversationTurn(message, promptText) {
  const key = `${message.channel.id}:${message.author.id}`;
  if (!perUserConversations.has(key)) perUserConversations.set(key, []);
  const history = perUserConversations.get(key);
  const userName = message.member?.displayName || message.author.globalName || message.author.username;
  const image = getImageAttachment(message);
  history.push({
    role: 'user',
    name: userName,
    text: sanitizeText(promptText) || '[empty]',
    imageUrl: image?.url || null
  });
  while (history.length > 16) history.shift();
  return { key, history, userName };
}

function pushAssistantTurn(key, replyText) {
  const history = perUserConversations.get(key);
  if (!history) return;
  history.push({ role: 'assistant', name: 'TmP Assistant', text: sanitizeText(replyText) || '...' });
  while (history.length > 16) history.shift();
}

async function askWithContext(message, client, question) {
  if (isRateLimited(message.author.id)) {
    await message.reply('Rate limit hit. Try again in a minute.');
    return;
  }

  try {
    await message.channel.sendTyping();
  } catch { }

  const imageUrls = [];
  let rawChannelHistory = 'No recent channel messages.';
  try {
    const lastMsgs = await message.channel.messages.fetch({ limit: 15 });
    const msgsArray = Array.from(lastMsgs.values()).reverse();
    rawChannelHistory = msgsArray.map(m => {
      const name = m.member?.displayName || m.author.globalName || m.author.username;
      let text = sanitizeText(m.content) || '';
      const img = getImageAttachment(m);
      if (img?.url) {
        imageUrls.push(img.url);
        const placeholder = `[Attachment ${imageUrls.length}]`;
        text = text ? `${text} ${placeholder}` : placeholder;
      } else if (!text) {
        text = '[attachment/embed]';
      }
      return `${name}: ${text}`;
    }).join('\n');
  } catch (err) {
    console.error('[RAG] Error fetching channel limit 15:', err.message);
  }

  const [context, verifiedIdentity] = await Promise.all([
    retrieveContext(question, message.channel.id),
    getVerifiedIdentity(message.guild?.id, message.author.id),
  ]);

  const username = message.member?.displayName || message.author.globalName || message.author.username;
  const { key, history } = pushConversationTurn(message, question);

  let dialogueBlock = 'No recent conversation.';
  if (history && history.length > 0) {
    dialogueBlock = history.map(turn => {
      let turnText = turn.text || '';
      if (turn.imageUrl) {
        imageUrls.push(turn.imageUrl);
        const placeholder = `[Attachment ${imageUrls.length}]`;
        turnText = turnText ? `${turnText} ${placeholder}` : placeholder;
      }
      return `${turn.name}: ${turnText}`;
    }).join('\n');
  }

  let questionText = question;
  const currentImg = getImageAttachment(message);
  if (currentImg?.url) {
    const idx = imageUrls.lastIndexOf(currentImg.url);
    if (idx !== -1) {
      const placeholder = `[Attachment ${idx + 1}]`;
      questionText = questionText ? `${questionText} ${placeholder}` : placeholder;
    }
  }

  const prompt = buildPrompt(questionText, context, username, verifiedIdentity, dialogueBlock, rawChannelHistory);

  try {
    let answer = '';
    if (imageUrls.length > 0) {
      const userContent = [{ type: 'text', text: prompt }];
      for (const url of imageUrls) {
        userContent.push({ type: 'image_url', image_url: { url } });
      }

      answer = await getChatCompletionForFeature('chatVision', [
        { role: 'user', content: userContent }
      ]);
    } else {
      answer = await getChatCompletionForFeature('chat', [
        { role: 'user', content: prompt }
      ]);
    }

    const finalAnswer = (answer || '').trim() || 'No answer generated.';
    pushAssistantTurn(key, finalAnswer);
    await message.reply(finalAnswer);
  } catch (err) {
    console.error('[RAG] Completion error:', err?.message || err);
    await message.reply('Sorry, I encountered an issue while generating a response.');
  }
}

async function buildHourlySummaryForChannel(channelId, startIso, endIso) {
  const { data } = await supabase
    .from('rag_messages')
    .select('username, content, created_at')
    .eq('channel_id', channelId)
    .gte('created_at', startIso)
    .lt('created_at', endIso)
    .order('created_at', { ascending: true })
    .limit(300);

  if (!data || data.length === 0) return;

  const transcript = data.map(r => `${r.username}: ${r.content}`).join('\n');
  try {
    const summary = await getChatCompletionForFeature('ragSummary', [
      { role: 'user', content: `${BASE_PERSONALITY}\n\nSummarize this one-hour server discussion in concise bullets:\n\n${transcript}` }
    ]);

    if (!summary || !summary.trim()) return;

    await supabase.from('rag_summaries').upsert({
      channel_id: channelId,
      hour_bucket: startIso,
      summary_text: summary.trim(),
      created_at: new Date().toISOString(),
    }, { onConflict: 'channel_id,hour_bucket' });
  } catch (err) {
    console.error('[RAG] buildHourlySummary error:', err.message);
  }
}

function scheduleRagHourlySummaries(client) {
  const run = async () => {
    const end = new Date();
    end.setMinutes(0, 0, 0);
    const start = new Date(end.getTime() - 60 * 60 * 1000);
    const startIso = start.toISOString();
    const endIso = end.toISOString();

    const { data } = await supabase
      .from('rag_messages')
      .select('channel_id')
      .gte('created_at', startIso)
      .lt('created_at', endIso)
      .limit(2000);

    const channels = [...new Set((data || []).map(r => r.channel_id))];
    for (const channelId of channels) {
      await buildHourlySummaryForChannel(channelId, startIso, endIso)
        .catch(err => console.error('[RAG] Hourly summary failed for channel:', channelId, err.message));
    }
  };

  // Run every hour
  setInterval(() => {
    run().catch(err => console.error('[RAG] Hourly summary interval error:', err.message));
  }, 60 * 60 * 1000);
}

async function handleRagChat(message, client) {
  if (message.author.bot) return;

  const ignoredChannels = process.env.IGNORED_CHAT_CHANNELS
    ? process.env.IGNORED_CHAT_CHANNELS.split(',').map(id => id.trim())
    : [];

  if (ignoredChannels.includes(message.channel.id)) {
    return;
  }

  const stored = await storeRagMessage(message);
  if (stored) {
    const channelId = stored.channel_id;
    if (!channelBuffers.has(channelId)) channelBuffers.set(channelId, { messages: [], lastAt: 0 });
    const buf = channelBuffers.get(channelId);
    buf.messages.push(stored);
    buf.lastAt = Date.now();

    await flushChunkIfReady(channelId, false);
  }

  const content = sanitizeText(message.content);
  const mentioned = message.mentions.has(client.user);
  const repliedToBot = await isReplyToBot(message, client);
  const image = getImageAttachment(message);



  // Explicit mention or reply to bot
  if (mentioned || repliedToBot) {
    const chatbotChannelId = config.discord?.chatbotChannelId;

    // If chatbot is restricted to a specific channel and triggered outside it
    if (chatbotChannelId && message.channel.id !== chatbotChannelId) {
      try {
        await message.reply(`Let's go to the proper channel! 👉 <#${chatbotChannelId}>`);

        const properChannel = message.guild?.channels.cache.get(chatbotChannelId)
          || await client.channels.fetch(chatbotChannelId).catch(() => null);

        if (properChannel && properChannel.isTextBased()) {
          await properChannel.send(`Hey <@${message.author.id}>, what did you want to talk about?`);
        }
      } catch (err) {
        console.error('[RAG] Error redirecting to chatbot channel:', err.message);
      }
      return;
    }

    const q = content.replace(new RegExp(`<@!?${client.user.id}>`, 'g'), '').trim() || 'Hey!';
    await askWithContext(message, client, q);
  }
}

module.exports = {
  handleRagChat,
  scheduleRagHourlySummaries
};
