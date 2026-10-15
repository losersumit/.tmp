# AGENTS & DEVELOPER GUIDELINES

Welcome to the **TmP - eClub Bot** codebase!

## 🧠 AI Provider & Model Configuration Architecture

All AI-powered tasks across the codebase must route through the central configuration: [`src/config/index.js`](./src/config/index.js) and the router in [`src/utils/aiUtils.js`](./src/utils/aiUtils.js).

### Rule: Adding New Features to Config
Whenever a new feature is implemented that utilizes AI (e.g. moderation, faq, summarization, translator):
1. **Never hardcode AI providers or model strings inside feature files.**
2. **Register the feature under `features` in [`src/config/index.js`](./src/config/index.js)**:
   ```javascript
   features: {
     todo: {
       provider: process.env.TODO_AI_PROVIDER || 'groq',
       model: process.env.TODO_AI_MODEL || 'openai/gpt-oss-120b',
       temperature: 0.1,
       maxTokens: 300
     },
     myNewFeature: {
       provider: process.env.MY_NEW_FEATURE_AI_PROVIDER || 'groq', // or 'gemini'
       model: process.env.MY_NEW_FEATURE_AI_MODEL || 'llama-3.3-70b-versatile',
       temperature: 0.2,
       maxTokens: 500
     }
   }
   ```
3. **Invoke completions using `getChatCompletionForFeature`**:
   ```javascript
   const { getChatCompletionForFeature } = require('../utils/aiUtils');

   const responseText = await getChatCompletionForFeature('myNewFeature', [
     { role: 'system', content: 'You are a helpful assistant.' },
     { role: 'user', content: userInput }
   ]);
   ```
4. **Environment Variables**:
   Allow configuring each feature's provider and model via `.env` (e.g. `TODO_AI_PROVIDER`, `TODO_AI_MODEL`).

---

## 🔒 Environment Variables Rule (.env)
- **`.env` is strictly reserved ONLY for sensitive API keys and secrets** (e.g. `DISCORD_TOKEN`, `SUPABASE_KEY`, `GROQ_API_KEY_ONE`, `GEMINI_API_KEY`).
- **Do NOT place role IDs or channel IDs inside `.env`**.

---

## 🗂️ Project Structure & Configuration

- `src/config/roles.js` — All Discord server role IDs and role groupings (staff, admin, bots, news).
- `src/config/channels.js` — All Discord server channel and category IDs.
- `src/config/index.js` — Centralized configuration combining roles, channels, database settings, and AI provider/model routing.
- `src/database/supabase.js` — Supabase client instance.
- `src/utils/aiUtils.js` — Universal AI dispatch router with key failover.
- `src/utils/discordUtils.js` — Discord jump link / attachment resolver.
- `src/features/` — Feature modules (e.g. `todoCommands.js`).
- `src/events/` — Discord event listeners (`ready.js`, `messageCreate.js`, `interactionCreate.js`).
- `database/schema.sql` — PostgreSQL schema for Supabase tables.

