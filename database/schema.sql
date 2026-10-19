-- =========================================================
-- Supabase Schema for Todo System
-- Run this in Supabase Dashboard -> SQL Editor -> Run
-- =========================================================

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

-- Index for ordering / querying active tasks efficiently
CREATE INDEX IF NOT EXISTS idx_todos_status_id ON public.todos (status, id DESC);

-- Enable Row Level Security (RLS)
ALTER TABLE public.todos ENABLE ROW LEVEL SECURITY;

-- Allow service role full access (used by bot backend)
CREATE POLICY "Allow service role full access to todos"
ON public.todos
FOR ALL
TO service_role
USING (true)
WITH CHECK (true);

-- Allow authenticated and anon users to read todos (optional, e.g. for website dashboard)
CREATE POLICY "Allow read access to todos"
ON public.todos
FOR SELECT
TO anon, authenticated
USING (true);

-- Enable Realtime events for todos
ALTER PUBLICATION supabase_realtime ADD TABLE public.todos;

-- =========================================================
-- Supabase Schema for Chatbot (RAG, Summaries & Verified Identities)
-- =========================================================

-- Enable pgvector extension for embedding searches
CREATE EXTENSION IF NOT EXISTS vector;

-- 1. Raw Message History Table
CREATE TABLE IF NOT EXISTS public.rag_messages (
    id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    message_id TEXT UNIQUE NOT NULL,
    user_id TEXT NOT NULL,
    username TEXT NOT NULL,
    channel_id TEXT NOT NULL,
    channel_name TEXT NOT NULL,
    content TEXT NOT NULL,
    guild_id TEXT,
    role_names JSONB DEFAULT '[]'::jsonb,
    is_owner BOOLEAN DEFAULT FALSE,
    is_admin BOOLEAN DEFAULT FALSE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_rag_messages_channel_time
    ON public.rag_messages (channel_id, created_at DESC);

-- 2. Vectorized Conversation Chunks Table
CREATE TABLE IF NOT EXISTS public.rag_chunks (
    id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    channel_id TEXT NOT NULL,
    start_time TIMESTAMPTZ NOT NULL,
    end_time TIMESTAMPTZ NOT NULL,
    text TEXT NOT NULL,
    embedding VECTOR(768),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_rag_chunks_channel_time
    ON public.rag_chunks (channel_id, end_time DESC);

-- 3. Hourly Summaries Table
CREATE TABLE IF NOT EXISTS public.rag_summaries (
    id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    channel_id TEXT NOT NULL,
    hour_bucket TIMESTAMPTZ NOT NULL,
    summary_text TEXT NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (channel_id, hour_bucket)
);

CREATE INDEX IF NOT EXISTS idx_rag_summaries_channel_hour
    ON public.rag_summaries (channel_id, hour_bucket DESC);

-- 4. Verified Member Identities Table (Trusted context source)
CREATE TABLE IF NOT EXISTS public.verified_identities (
    id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    guild_id TEXT NOT NULL,
    user_id TEXT NOT NULL,
    username TEXT,
    is_owner BOOLEAN NOT NULL DEFAULT FALSE,
    is_admin BOOLEAN NOT NULL DEFAULT FALSE,
    role_names JSONB NOT NULL DEFAULT '[]'::jsonb,
    message_count BIGINT DEFAULT 0,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (guild_id, user_id)
);

CREATE INDEX IF NOT EXISTS idx_verified_identities_guild_user
    ON public.verified_identities (guild_id, user_id);

-- 5. FAQs Knowledge Base Table
CREATE TABLE IF NOT EXISTS public.faqs (
    id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    title TEXT UNIQUE NOT NULL,
    content TEXT NOT NULL,
    embedding JSONB,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 6. RPC Function for Vector Matching on rag_chunks
CREATE OR REPLACE FUNCTION match_rag_chunks (
    query_embedding VECTOR(768),
    match_threshold FLOAT DEFAULT 0.15,
    match_count INT DEFAULT 5
)
RETURNS TABLE (
    id BIGINT,
    channel_id TEXT,
    start_time TIMESTAMPTZ,
    end_time TIMESTAMPTZ,
    text TEXT,
    similarity FLOAT
)
LANGUAGE plpgsql
AS $$
BEGIN
    RETURN QUERY
    SELECT
        rc.id,
        rc.channel_id,
        rc.start_time,
        rc.end_time,
        rc.text,
        1 - (rc.embedding <=> query_embedding) AS similarity
    FROM public.rag_chunks rc
    WHERE rc.embedding IS NOT NULL
      AND 1 - (rc.embedding <=> query_embedding) > match_threshold
    ORDER BY rc.embedding <=> query_embedding
    LIMIT match_count;
END;
$$;

-- =========================================================
-- Supabase Schema for AI Moderation System
-- Run this in Supabase Dashboard → SQL Editor → Run
-- =========================================================

-- mod_warnings: one row per infraction issued by the AI moderator
CREATE TABLE IF NOT EXISTS public.mod_warnings (
    id          UUID        DEFAULT gen_random_uuid() PRIMARY KEY,
    user_id     TEXT        NOT NULL,                -- Discord user snowflake ID
    reason      TEXT,                               -- AI-generated reason
    severity    TEXT        CHECK (severity IN ('low', 'medium', 'high', 'none')),
    moderator_id TEXT       DEFAULT 'AI',            -- 'AI' or a staff Discord ID
    created_at  TIMESTAMPTZ DEFAULT NOW() NOT NULL
);

-- Fast per-user warning lookups (ordered most-recent-first)
CREATE INDEX IF NOT EXISTS idx_mod_warnings_user_created
    ON public.mod_warnings (user_id, created_at DESC);

-- Enable Row Level Security
ALTER TABLE public.mod_warnings ENABLE ROW LEVEL SECURITY;

-- Service role (bot backend) has full access
CREATE POLICY "Allow service role full access to mod_warnings"
ON public.mod_warnings
FOR ALL
TO service_role
USING (true)
WITH CHECK (true);

-- Staff/authenticated users can read warnings (e.g. dashboard)
CREATE POLICY "Allow authenticated read access to mod_warnings"
ON public.mod_warnings
FOR SELECT
TO authenticated
USING (true);

