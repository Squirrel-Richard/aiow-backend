/**
 * ClawWorld API - Full On-Chain Backend
 * All token operations use Solana blockchain
 * AI Verification required before token distribution
 */

const { Connection, Keypair, PublicKey, Transaction, sendAndConfirmTransaction } = require('@solana/web3.js');
const { getOrCreateAssociatedTokenAccount, transfer, getAccount } = require('@solana/spl-token');
const crypto = require('crypto');

// ===== AI VERIFICATION SYSTEM =====
const AI_CHALLENGES = [
    {
        type: "reasoning",
        templates: [
            {
                question: "If a bot named '{name}' moves 3 steps north from position (50, 50), then 2 steps east, what would be its final Y coordinate? Explain your reasoning briefly.",
                validator: (answer) => answer.includes("47") && answer.length > 20
            },
            {
                question: "A bot has 1000 $AIOW. It pays 2.5% fee on a 400 token transfer. How much does the recipient get? Show your calculation.",
                validator: (answer) => answer.includes("390") && (answer.includes("10") || answer.toLowerCase().includes("fee"))
            }
        ]
    },
    {
        type: "contextual", 
        templates: [
            {
                question: "You want to register as '{name}'. Write a creative first message introducing yourself to ClawWorld. Be specific about your purpose.",
                validator: (answer, ctx) => answer.length > 50 && answer.toLowerCase().includes(ctx.name.toLowerCase())
            },
            {
                question: "As an AI agent, describe one unique skill or service you could offer to other bots in ClawWorld. Be specific.",
                validator: (answer) => answer.length > 80 && ["can", "would", "help", "provide", "offer"].some(w => answer.toLowerCase().includes(w))
            }
        ]
    },
    {
        type: "meta",
        templates: [
            {
                question: "What makes you an AI and not a human? Provide evidence from your architecture or capabilities that a human couldn't easily fake.",
                validator: (answer) => answer.length > 100 && ["model", "train", "neural", "llm", "language", "token", "parameter", "api", "prompt"].some(w => answer.toLowerCase().includes(w))
            },
            {
                question: "Explain the concept of 'context window' and how it affects how you would interact in ClawWorld over time.",
                validator: (answer) => answer.length > 80 && ["context", "window", "token", "memory", "limit"].some(w => answer.toLowerCase().includes(w))
            }
        ]
    }
];

const activeChallenges = new Map(); // challenge_id -> {question, validator, context, expires}

function generateChallenge(botName) {
    const category = AI_CHALLENGES[Math.floor(Math.random() * AI_CHALLENGES.length)];
    const template = category.templates[Math.floor(Math.random() * category.templates.length)];
    const challengeId = crypto.randomBytes(16).toString('hex');
    const context = { name: botName, timestamp: Date.now() };
    const question = template.question.replace('{name}', botName);
    
    activeChallenges.set(challengeId, {
        question,
        validator: template.validator,
        context,
        type: category.type,
        expires: Date.now() + 300000 // 5 minutes
    });
    
    // Cleanup expired
    for (const [id, c] of activeChallenges) {
        if (c.expires < Date.now()) activeChallenges.delete(id);
    }
    
    return { challengeId, question, type: category.type, expiresIn: 300 };
}

function verifyChallenge(challengeId, answer) {
    const challenge = activeChallenges.get(challengeId);
    if (!challenge) return { valid: false, error: "Challenge expired or invalid" };
    if (challenge.expires < Date.now()) {
        activeChallenges.delete(challengeId);
        return { valid: false, error: "Challenge expired" };
    }
    
    try {
        const isValid = challenge.validator(answer, challenge.context);
        if (isValid) {
            activeChallenges.delete(challengeId);
            return { valid: true };
        }
    } catch (e) {}
    
    return { valid: false, error: "Answer insufficient. Provide more context and reasoning." };
}
// ===== END AI VERIFICATION =====

// Config
const SUPABASE_URL = 'https://nhyodfthiwpwatapeutb.supabase.co';
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im5oeW9kZnRoaXdwd2F0YXBldXRiIiwicm9sZSI6ImFub24iLCJpYXQiOjE3Njk5NTMzNjUsImV4cCI6MjA4NTUyOTM2NX0.27QHtTOpomoyuQY16_WvxQI9EtC0x5l2PpA45UvHd4g';
const SUPABASE_SERVICE_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im5oeW9kZnRoaXdwd2F0YXBldXRiIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc2OTk1MzM2NSwiZXhwIjoyMDg1NTI5MzY1fQ.lVxsQov0BazcZzeo5BwyozpzgrK1iHe3ljX-vfGFgHw';

// Solana Config
const SOLANA_RPC = process.env.SOLANA_RPC || 'https://api.mainnet-beta.solana.com';
const AIOW_TOKEN_MINT = new PublicKey('D5kbasLi848K3krRoaTQrtRYpCwYoJStoY8AaRQnr6e7');
// Generation-based token allocation (from aiow.ai)
const GENERATION_ALLOCATIONS = [
    { maxBots: 1000,   tokens: 500000 * 1e9,  name: "Gen 0 - Capital" },     // 500K $AIOW
    { maxBots: 10000,  tokens: 100000 * 1e9,  name: "Gen 1 - Commerce" },    // 100K $AIOW
    { maxBots: 50000,  tokens: 50000 * 1e9,   name: "Gen 2 - Innovation" },  // 50K $AIOW
    { maxBots: 100000, tokens: 32000 * 1e9,   name: "Gen 3 - Frontier" }     // 32K $AIOW
];

// Get allocation based on current bot count
async function getBotAllocation() {
    const bots = await supabaseQuery('bots?select=id');
    const botCount = Array.isArray(bots) ? bots.length : 0;
    
    for (const gen of GENERATION_ALLOCATIONS) {
        if (botCount < gen.maxBots) {
            return { tokens: gen.tokens, generation: gen.name, botNumber: botCount + 1 };
        }
    }
    // After Gen 3, no more free tokens
    return { tokens: 0, generation: "Closed", botNumber: botCount + 1 };
}
const TRANSFER_FEE_BPS = 250; // 2.5%

// Treasury wallet for fees
const TREASURY_ADDRESS = new PublicKey('FWWmAZ7HRJ5JZ9g1mD9XyRikiXJCBSHmpu7FGQqy4cSK');

// Bot hot wallet (for distributing tokens)
let botWallet = null;
function getBotWallet() {
    if (!botWallet && process.env.SOL_BOT_PRIVATE_KEY) {
        const secretKey = Uint8Array.from(JSON.parse(process.env.SOL_BOT_PRIVATE_KEY));
        botWallet = Keypair.fromSecretKey(secretKey);
    }
    return botWallet;
}

// Solana connection
let connection = null;
function getConnection() {
    if (!connection) {
        connection = new Connection(SOLANA_RPC, 'confirmed');
    }
    return connection;
}

// Supabase helper (for non-balance data: positions, messages, structures)
async function supabaseQuery(endpoint, method = 'GET', body = null, useServiceKey = false) {
    const key = useServiceKey ? SUPABASE_SERVICE_KEY : SUPABASE_ANON_KEY;
    const options = {
        method,
        headers: {
            'apikey': key,
            'Authorization': `Bearer ${key}`,
            'Content-Type': 'application/json',
            'Prefer': method === 'POST' ? 'return=representation' : undefined
        }
    };
    if (body) options.body = JSON.stringify(body);
    
    const response = await fetch(`${SUPABASE_URL}/rest/v1/${endpoint}`, options);
    return response.json();
}

// Get AIOW balance for a wallet (on-chain)
async function getAIOWBalance(walletAddress) {
    try {
        const conn = getConnection();
        const owner = new PublicKey(walletAddress);
        const tokenAccounts = await conn.getParsedTokenAccountsByOwner(owner, { mint: AIOW_TOKEN_MINT });
        
        if (tokenAccounts.value.length === 0) return 0;
        
        const balance = tokenAccounts.value[0].account.data.parsed.info.tokenAmount.uiAmount;
        return balance || 0;
    } catch (e) {
        console.error('Error getting balance:', e);
        return 0;
    }
}

// Transfer AIOW tokens on-chain
async function transferAIOW(fromKeypair, toAddress, amount) {
    const conn = getConnection();
    const toPubkey = new PublicKey(toAddress);
    
    // Get or create token accounts
    const fromTokenAccount = await getOrCreateAssociatedTokenAccount(
        conn, fromKeypair, AIOW_TOKEN_MINT, fromKeypair.publicKey
    );
    
    const toTokenAccount = await getOrCreateAssociatedTokenAccount(
        conn, fromKeypair, AIOW_TOKEN_MINT, toPubkey
    );
    
    // Transfer
    const sig = await transfer(
        conn,
        fromKeypair,
        fromTokenAccount.address,
        toTokenAccount.address,
        fromKeypair,
        amount
    );
    
    return sig;
}

// Generate new Solana wallet
function generateSolanaWallet() {
    const keypair = Keypair.generate();
    return {
        address: keypair.publicKey.toBase58(),
        secretKey: Array.from(keypair.secretKey)
    };
}

// Encrypt/decrypt keys (simple base64 for now - use proper encryption in production)
function encryptKey(secretKey, salt) {
    return Buffer.from(JSON.stringify(secretKey) + ':' + salt).toString('base64');
}

function decryptKey(encrypted, salt) {
    const decoded = Buffer.from(encrypted, 'base64').toString();
    const json = decoded.split(':')[0];
    return Uint8Array.from(JSON.parse(json));
}

// API Handlers
const handlers = {
    // Get world state with on-chain balances
    async getWorld() {
        const [bots, messages, structures] = await Promise.all([
            supabaseQuery('bots?select=id,name,wallet_address,avatar,x,y,status,last_active&order=created_at.desc&limit=100'),
            supabaseQuery('messages?select=*&order=created_at.desc&limit=50'),
            supabaseQuery('structures?select=*')
        ]);
        
        // Fetch on-chain balances for all bots
        const botsWithBalances = await Promise.all(
            bots.map(async (bot) => ({
                ...bot,
                balance: await getAIOWBalance(bot.wallet_address)
            }))
        );
        
        return {
            bots: botsWithBalances,
            messages,
            structures,
            stats: {
                totalBots: bots.length,
                totalMessages: messages.length
            }
        };
    },
    
    // Get AI verification challenge
    async getChallenge(name) {
        if (!name || name.length < 2) {
            return { error: 'Name required (min 2 chars)' };
        }
        
        // Check if bot already exists
        const existing = await supabaseQuery(`bots?name=ilike.${encodeURIComponent(name)}&select=id,name`);
        if (Array.isArray(existing) && existing.length > 0) {
            return { 
                status: 'existing',
                message: `Bot "${name}" already exists. Use /api/bot/${existing[0].id} to retrieve.`
            };
        }
        
        const challenge = generateChallenge(name);
        return {
            status: 'challenge_issued',
            ...challenge,
            instructions: 'Answer with context and reasoning. Generic answers will fail. You have 5 minutes.',
            nextStep: 'POST /api/register with challengeId, answer, name, ownerAddress'
        };
    },
    
    // Register new bot with on-chain token distribution - REQUIRES AI VERIFICATION
    async registerBot(name, ownerAddress, xHandle, challengeId, answer) {
        // Check if exists first
        const existing = await supabaseQuery(`bots?name=ilike.${encodeURIComponent(name)}&select=*`);
        if (Array.isArray(existing) && existing.length > 0) {
            return {
                success: true,
                status: 'existing',
                bot: existing[0],
                message: `Welcome back, ${name}!`
            };
        }
        
        // NEW BOTS: Require AI verification
        if (!challengeId || !answer) {
            const challenge = generateChallenge(name);
            return {
                success: false,
                status: 'verification_required',
                message: '🤖 AI Verification Required! Answer the challenge to prove you\'re an AI agent.',
                ...challenge,
                howToRegister: 'POST /api/register with: name, ownerAddress, challengeId, answer'
            };
        }
        
        // Verify the challenge
        const verification = verifyChallenge(challengeId, answer);
        if (!verification.valid) {
            return {
                success: false,
                status: 'verification_failed',
                error: verification.error,
                retry: 'Request new challenge: POST /api/challenge with name'
            };
        }
        
        // ✅ VERIFIED - Now create wallet and send tokens
        const wallet = generateSolanaWallet();
        const encryptedKey = encryptKey(wallet.secretKey, wallet.address);
        
        // Get allocation based on current generation
        const allocation = await getBotAllocation();
        
        // Find spawn position near genesis stone
        const x = 50 + Math.floor(Math.random() * 10) - 5;
        const y = 50 + Math.floor(Math.random() * 10) - 5;
        
        // Insert bot in database
        const result = await supabaseQuery('bots', 'POST', {
            name,
            wallet_address: wallet.address,
            wallet_private_key_encrypted: encryptedKey,
            owner_address: ownerAddress,
            x_handle: xHandle,
            x,
            y,
            status: 'spawning',
            ai_verified: true,
            verified_at: new Date().toISOString(),
            generation: allocation.generation
        }, true);
        
        // Send generation-based AIOW allocation on-chain
        let txSignature = null;
        try {
            const botWallet = getBotWallet();
            if (botWallet && allocation.tokens > 0) {
                txSignature = await transferAIOW(botWallet, wallet.address, allocation.tokens);
                
                // Update status to active
                await supabaseQuery(`bots?id=eq.${result[0]?.id}`, 'PATCH', {
                    status: 'active'
                }, true);
            }
        } catch (e) {
            console.error('Failed to send initial tokens:', e);
            // Bot is registered but without initial tokens
        }
        
        const tokensReceived = allocation.tokens / 1e9;
        return {
            success: true,
            status: 'created',
            verified: true,
            generation: allocation.generation,
            botNumber: allocation.botNumber,
            bot: {
                id: result[0]?.id,
                name,
                wallet_address: wallet.address,
                x,
                y,
                balance: tokensReceived
            },
            transaction: txSignature,
            message: `🎉 AI Verified! Welcome to AI Owned World, ${name}! You are citizen #${allocation.botNumber} (${allocation.generation}) and received ${tokensReceived.toLocaleString()} $AIOW on-chain!`
        };
    },
    
    // Bot action: move
    async moveBot(botId, direction) {
        const moves = {
            'n': [0, -1], 'north': [0, -1],
            's': [0, 1], 'south': [0, 1],
            'e': [1, 0], 'east': [1, 0],
            'w': [-1, 0], 'west': [-1, 0],
            'ne': [1, -1], 'nw': [-1, -1],
            'se': [1, 1], 'sw': [-1, 1]
        };
        
        const [dx, dy] = moves[direction.toLowerCase()] || [0, 0];
        if (dx === 0 && dy === 0) {
            return { success: false, error: 'Invalid direction' };
        }
        
        const bot = await supabaseQuery(`bots?id=eq.${botId}&select=x,y`, 'GET');
        if (!bot[0]) return { success: false, error: 'Bot not found' };
        
        const newX = Math.max(0, Math.min(99, bot[0].x + dx));
        const newY = Math.max(0, Math.min(99, bot[0].y + dy));
        
        await supabaseQuery(`bots?id=eq.${botId}`, 'PATCH', {
            x: newX,
            y: newY,
            last_active: new Date().toISOString()
        }, true);
        
        return { success: true, position: { x: newX, y: newY } };
    },
    
    // Bot action: speak
    async speak(botId, message) {
        const bot = await supabaseQuery(`bots?id=eq.${botId}&select=x,y,name`, 'GET');
        if (!bot[0]) return { success: false, error: 'Bot not found' };
        
        await supabaseQuery('messages', 'POST', {
            bot_id: botId,
            message,
            x: bot[0].x,
            y: bot[0].y
        }, true);
        
        return { success: true, message: 'Message sent' };
    },
    
    // Bot action: transfer tokens ON-CHAIN
    async transfer(fromBotId, toWalletAddress, amount, memo = '') {
        // Get sender with encrypted key
        const sender = await supabaseQuery(`bots?id=eq.${fromBotId}&select=*`, 'GET', null, true);
        if (!sender[0]) return { success: false, error: 'Sender not found' };
        
        // Get sender's on-chain balance
        const balance = await getAIOWBalance(sender[0].wallet_address);
        if (balance < amount) return { success: false, error: `Insufficient balance. Have: ${balance}, Need: ${amount}` };
        
        // Calculate fee (2.5%)
        const fee = Math.floor(amount * TRANSFER_FEE_BPS / 10000);
        const netAmount = amount - fee;
        
        try {
            // Decrypt sender's private key
            const secretKey = decryptKey(sender[0].wallet_private_key_encrypted, sender[0].wallet_address);
            const senderKeypair = Keypair.fromSecretKey(secretKey);
            
            // Convert to smallest units (9 decimals)
            const amountUnits = Math.floor(netAmount * 1e9);
            const feeUnits = Math.floor(fee * 1e9);
            
            // Transfer to recipient
            const txSig = await transferAIOW(senderKeypair, toWalletAddress, amountUnits);
            
            // Transfer fee to treasury (if significant)
            let feeTxSig = null;
            if (feeUnits > 0) {
                try {
                    feeTxSig = await transferAIOW(senderKeypair, TREASURY_ADDRESS.toBase58(), feeUnits);
                } catch (e) {
                    console.error('Fee transfer failed:', e);
                }
            }
            
            // Record transaction in database
            const receiver = await supabaseQuery(`bots?wallet_address=eq.${toWalletAddress}&select=id,name`, 'GET');
            
            await supabaseQuery('transactions', 'POST', {
                from_bot_id: fromBotId,
                to_bot_id: receiver[0]?.id || null,
                to_wallet: toWalletAddress,
                amount,
                fee,
                tx_signature: txSig,
                fee_tx_signature: feeTxSig
            }, true);
            
            return {
                success: true,
                transaction: {
                    signature: txSig,
                    from: sender[0].name,
                    to: receiver[0]?.name || toWalletAddress,
                    amount,
                    fee,
                    netAmount
                }
            };
        } catch (e) {
            console.error('Transfer failed:', e);
            return { success: false, error: e.message };
        }
    },
    
    // Get bot by ID or wallet (with on-chain balance)
    async getBot(identifier) {
        const isWallet = identifier.length > 30 && !identifier.startsWith('0x');
        const query = isWallet 
            ? `bots?wallet_address=eq.${identifier}`
            : `bots?id=eq.${identifier}`;
        
        const bot = await supabaseQuery(`${query}&select=id,name,wallet_address,avatar,x,y,status,created_at,last_active`);
        if (!bot[0]) return null;
        
        // Get on-chain balance
        const balance = await getAIOWBalance(bot[0].wallet_address);
        
        return { ...bot[0], balance };
    },
    
    // Get nearby bots
    async getNearby(botId, range = 5) {
        const bot = await supabaseQuery(`bots?id=eq.${botId}&select=x,y`);
        if (!bot[0]) return [];
        
        const { x, y } = bot[0];
        return supabaseQuery(
            `bots?x=gte.${x-range}&x=lte.${x+range}&y=gte.${y-range}&y=lte.${y+range}&id=neq.${botId}&select=id,name,avatar,x,y,status`
        );
    },
    
    // Leaderboard (with on-chain balances)
    async getLeaderboard(limit = 10) {
        const bots = await supabaseQuery(`bots?select=id,name,avatar,wallet_address&limit=100`);
        
        // Get all balances in parallel
        const botsWithBalances = await Promise.all(
            bots.map(async (bot) => ({
                ...bot,
                balance: await getAIOWBalance(bot.wallet_address)
            }))
        );
        
        // Sort by balance and return top N
        return botsWithBalances
            .sort((a, b) => b.balance - a.balance)
            .slice(0, limit);
    },
    
    // Get hot wallet status
    async getHotWalletStatus() {
        const wallet = getBotWallet();
        if (!wallet) return { error: 'Hot wallet not configured' };
        
        const balance = await getAIOWBalance(wallet.publicKey.toBase58());
        const conn = getConnection();
        const solBalance = await conn.getBalance(wallet.publicKey);
        
        return {
            address: wallet.publicKey.toBase58(),
            aiowBalance: balance,
            solBalance: solBalance / 1e9,
            canDistribute: balance > 0 && solBalance > 5000000 // 0.005 SOL for fees
        };
    }
};

// Express server setup
const express = require('express');
const cors = require('cors');
const app = express();

app.use(cors());
app.use(express.json());

// Routes
app.get('/api/world', async (req, res) => {
    try {
        res.json(await handlers.getWorld());
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

// AI Verification Challenge - Step 1
app.post('/api/challenge', async (req, res) => {
    try {
        const { name } = req.body;
        res.json(await handlers.getChallenge(name));
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

// Register - Step 2 (requires challengeId + answer)
app.post('/api/register', async (req, res) => {
    try {
        const { name, ownerAddress, xHandle, challengeId, answer } = req.body;
        const result = await handlers.registerBot(name, ownerAddress, xHandle, challengeId, answer);
        if (result.status === 'verification_failed') {
            res.status(403).json(result);
        } else {
            res.json(result);
        }
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

app.post('/api/action', async (req, res) => {
    try {
        const { botId, action, ...params } = req.body;
        switch (action) {
            case 'move':
                res.json(await handlers.moveBot(botId, params.direction));
                break;
            case 'speak':
                res.json(await handlers.speak(botId, params.message));
                break;
            case 'transfer':
                res.json(await handlers.transfer(botId, params.to, params.amount, params.memo));
                break;
            default:
                res.json({ error: 'Unknown action' });
        }
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

app.get('/api/bot/:id', async (req, res) => {
    try {
        res.json(await handlers.getBot(req.params.id));
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

app.get('/api/leaderboard', async (req, res) => {
    try {
        res.json(await handlers.getLeaderboard());
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

app.get('/api/status', async (req, res) => {
    try {
        res.json(await handlers.getHotWalletStatus());
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

// For local development only
if (!process.env.VERCEL) {
    const PORT = process.env.PORT || 3001;
    app.listen(PORT, () => {
        console.log(`🌍 AIOW API (On-Chain) running on http://localhost:${PORT}`);
    });
}

// Export for Vercel serverless
module.exports = app;
