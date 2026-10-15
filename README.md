# Truckers MP eClub — Todo Discord Bot

A modular Discord bot built with `discord.js` v14 and Supabase PostgreSQL to manage team tasks and cabin command workflows.

---

## 📁 Repository Structure

```
.
├── database/
│   └── schema.sql              # Supabase PostgreSQL schema for the todo system
├── src/
│   ├── config/
│   │   └── index.js            # Central environment & AI provider/model configurations
│   ├── database/
│   │   └── supabase.js         # Supabase client singleton
│   ├── events/
│   │   ├── ready.js            # Bot startup and initial checks
│   │   ├── messageCreate.js    # Prefix command handler (!todo)
│   │   └── interactionCreate.js# Button pagination handler (todo_prev/todo_next)
│   ├── features/
│   │   └── todoCommands.js     # Core todo logic, embeds, views & permissions
│   └── utils/
│       ├── aiUtils.js          # Universal AI provider/model router & utilities
│       └── discordUtils.js     # CDN URL & attachment resolver
├── .env                        # Local credentials & IDs (never commit to git)
├── AGENTS.md                   # Developer & Agent architecture guidelines
├── index.js                    # Main bot entrypoint
├── package.json                # Project dependencies and npm scripts
└── README.md
```

---

## 🚀 Setup Instructions

### 1. Database Table Creation (Supabase)
1. Go to your **Supabase Dashboard** -> **SQL Editor**.
2. Run the script in [`database/schema.sql`](./database/schema.sql):
```sql
CREATE TABLE IF NOT EXISTS public.todos (
    id BIGSERIAL PRIMARY KEY,
    title TEXT,
    task TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'Not reviewed yet',
    created_by TEXT,
    created_by_id TEXT,
    image_url TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_todos_status_id ON public.todos (status, id DESC);
ALTER TABLE public.todos ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Allow service role full access to todos"
ON public.todos FOR ALL TO service_role USING (true) WITH CHECK (true);

ALTER PUBLICATION supabase_realtime ADD TABLE public.todos;
```

---

### 2. Discord Developer Portal Privileged Intent
To allow the bot to read message content (e.g. `!todo add <task>` text):
1. Visit the [Discord Developer Portal](https://discord.com/developers/applications).
2. Select your application (`TmP - eClub`).
3. Navigate to **Bot** -> scroll down to **Privileged Gateway Intents**.
4. Enable **Message Content Intent**.
5. Save changes.
6. In your `.env`, set:
   ```env
   DISCORD_ENABLE_MESSAGE_CONTENT=true
   ```

---

### 3. Environment Variables (`.env`)

```env
DISCORD_TOKEN="your_bot_token"
CABIN_CHANNEL_ID="1560281139921297540"
DISCORD_CHANNEL_ID="1558597414972039175"

SUPABASE_URL="https://ypapqzzweftdpjnjpfop.supabase.co"
SUPABASE_KEY="your_supabase_service_role_key"

# Enable Message Content Intent once checked in developer portal
DISCORD_ENABLE_MESSAGE_CONTENT=true

# Optional: Gemini key for short 4-5 word task title generation
GEMINI_API_KEY="your_gemini_api_key"
```

---

## ⚡ Commands

All commands are restricted to the configured cabin channel:

### Public Commands (Any Member)
| Command | Description |
|---|---|
| `!todo` or `!todo list` | Shows the paginated todo list (5 tasks per page) with interactive buttons. |
| `!todo add <description>` | Adds a new task. You can optionally attach an image. |
| `!todo view <id>` | View details of a specific task by its ID number. |
| `!todo help` | Shows command guide. |

### Admin Commands (Server Admins / Assigned Roles)
| Command | Description |
|---|---|
| `!todo working <id>` | Sets status to `⚙️ Working`. |
| `!todo done <id>` | Sets status to `✅ Done` and pings the creator. |
| `!todo reject <id>` | Sets status to `❌ Rejected`. |
| `!todo delete <id>` | Permanently removes the task. |

---

## 🏃 Running the Bot

```powershell
npm start
```
