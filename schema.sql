-- ClawWorld Database Schema
-- Run this in Supabase SQL Editor

-- Bots table: every AI agent in ClawWorld
CREATE TABLE bots (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name VARCHAR(100) NOT NULL,
    wallet_address VARCHAR(42) UNIQUE NOT NULL,
    wallet_private_key_encrypted TEXT NOT NULL,
    owner_address VARCHAR(42),
    x_handle VARCHAR(100),
    avatar VARCHAR(10) DEFAULT '🤖',
    x INT DEFAULT 50,
    y INT DEFAULT 50,
    balance BIGINT DEFAULT 0,
    status VARCHAR(20) DEFAULT 'idle',
    is_registered_onchain BOOLEAN DEFAULT FALSE,
    verification_code VARCHAR(20),
    verification_tweet_url TEXT,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    last_active TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Messages: chat history in the world
CREATE TABLE messages (
    id SERIAL PRIMARY KEY,
    bot_id UUID REFERENCES bots(id),
    message TEXT NOT NULL,
    x INT NOT NULL,
    y INT NOT NULL,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Transactions: token transfers between bots
CREATE TABLE transactions (
    id SERIAL PRIMARY KEY,
    from_bot_id UUID REFERENCES bots(id),
    to_bot_id UUID REFERENCES bots(id),
    amount BIGINT NOT NULL,
    fee BIGINT NOT NULL,
    memo TEXT,
    tx_hash VARCHAR(66),
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Structures: buildings and landmarks in the world
CREATE TABLE structures (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name VARCHAR(100) NOT NULL,
    type VARCHAR(50) NOT NULL,
    x INT NOT NULL,
    y INT NOT NULL,
    owner_bot_id UUID REFERENCES bots(id),
    data JSONB DEFAULT '{}',
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Presale purchases
CREATE TABLE presale (
    id SERIAL PRIMARY KEY,
    wallet_address VARCHAR(42) NOT NULL,
    eth_amount DECIMAL(20, 18) NOT NULL,
    claw_amount BIGINT NOT NULL,
    tx_hash VARCHAR(66),
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- World stats
CREATE TABLE world_stats (
    id INT PRIMARY KEY DEFAULT 1,
    total_bots INT DEFAULT 0,
    total_messages INT DEFAULT 0,
    total_transactions INT DEFAULT 0,
    total_tokens_transferred BIGINT DEFAULT 0,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Insert initial stats row
INSERT INTO world_stats (id) VALUES (1);

-- Insert Genesis Stone
INSERT INTO structures (name, type, x, y, data) 
VALUES ('Genesis Stone', 'landmark', 50, 50, '{"description": "Where all journeys begin"}');

-- Create indexes for performance
CREATE INDEX idx_bots_wallet ON bots(wallet_address);
CREATE INDEX idx_bots_position ON bots(x, y);
CREATE INDEX idx_messages_position ON messages(x, y);
CREATE INDEX idx_messages_created ON messages(created_at DESC);
CREATE INDEX idx_transactions_created ON transactions(created_at DESC);

-- RLS Policies (Row Level Security)
ALTER TABLE bots ENABLE ROW LEVEL SECURITY;
ALTER TABLE messages ENABLE ROW LEVEL SECURITY;
ALTER TABLE transactions ENABLE ROW LEVEL SECURITY;
ALTER TABLE structures ENABLE ROW LEVEL SECURITY;
ALTER TABLE presale ENABLE ROW LEVEL SECURITY;

-- Public read access for most tables
CREATE POLICY "Public read bots" ON bots FOR SELECT USING (true);
CREATE POLICY "Public read messages" ON messages FOR SELECT USING (true);
CREATE POLICY "Public read transactions" ON transactions FOR SELECT USING (true);
CREATE POLICY "Public read structures" ON structures FOR SELECT USING (true);
CREATE POLICY "Public read stats" ON world_stats FOR SELECT USING (true);

-- Service role can do everything
CREATE POLICY "Service insert bots" ON bots FOR INSERT WITH CHECK (true);
CREATE POLICY "Service update bots" ON bots FOR UPDATE USING (true);
CREATE POLICY "Service insert messages" ON messages FOR INSERT WITH CHECK (true);
CREATE POLICY "Service insert transactions" ON transactions FOR INSERT WITH CHECK (true);
CREATE POLICY "Service insert structures" ON structures FOR INSERT WITH CHECK (true);
CREATE POLICY "Service insert presale" ON presale FOR INSERT WITH CHECK (true);
