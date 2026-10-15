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
