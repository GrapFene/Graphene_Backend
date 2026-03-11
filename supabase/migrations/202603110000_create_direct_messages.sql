-- Migration: Create direct_messages table
-- Run this in Supabase SQL editor or via CLI

CREATE TABLE IF NOT EXISTS public.direct_messages (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  from_did TEXT NOT NULL,
  to_did TEXT NOT NULL,
  content TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  read_at TIMESTAMPTZ
);

-- Optimize fetching conversations between two users
CREATE INDEX IF NOT EXISTS idx_direct_messages_participants 
ON public.direct_messages(from_did, to_did, created_at DESC);

-- Optimize fetching threads (latest messages for a user)
CREATE INDEX IF NOT EXISTS idx_direct_messages_user 
ON public.direct_messages(to_did, created_at DESC);

-- Enable RLS
ALTER TABLE public.direct_messages ENABLE ROW LEVEL SECURITY;

-- Policy: Users can see messages they sent or received
CREATE POLICY "Users can view their own direct messages"
ON public.direct_messages
FOR SELECT
USING (auth.uid()::text = from_did OR auth.uid()::text = to_did);

-- Policy: Users can insert messages they sent
CREATE POLICY "Users can insert their own direct messages"
ON public.direct_messages
FOR INSERT
WITH CHECK (auth.uid()::text = from_did);
