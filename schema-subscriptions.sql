-- ClawWorld Subscription System Schema
-- Run this in Supabase SQL Editor

-- Add subscription fields to bots table
ALTER TABLE bots ADD COLUMN IF NOT EXISTS subscription_plan TEXT DEFAULT 'free';
ALTER TABLE bots ADD COLUMN IF NOT EXISTS subscription_expires TIMESTAMPTZ;
ALTER TABLE bots ADD COLUMN IF NOT EXISTS tx_remaining INTEGER DEFAULT 0;
ALTER TABLE bots ADD COLUMN IF NOT EXISTS stripe_customer_id TEXT;

-- Subscription logs table
CREATE TABLE IF NOT EXISTS subscription_logs (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    type TEXT NOT NULL,  -- 'payment', 'eth_distribution', 'subscription_change'
    bot_id UUID REFERENCES bots(id),
    amount TEXT,
    tx_hash TEXT,
    details JSONB DEFAULT '{}',
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Index for faster lookups
CREATE INDEX IF NOT EXISTS idx_subscription_logs_bot_id ON subscription_logs(bot_id);
CREATE INDEX IF NOT EXISTS idx_subscription_logs_type ON subscription_logs(type);
CREATE INDEX IF NOT EXISTS idx_bots_subscription ON bots(subscription_plan);

-- Enable RLS
ALTER TABLE subscription_logs ENABLE ROW LEVEL SECURITY;

-- Allow read for authenticated users
CREATE POLICY "Read own subscription logs" ON subscription_logs
    FOR SELECT USING (true);

-- Only service role can insert
CREATE POLICY "Service role insert" ON subscription_logs
    FOR INSERT WITH CHECK (true);
