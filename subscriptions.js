/**
 * ClawWorld Subscription System
 * Handles Stripe payments and ETH distribution to bots
 */

const { ethers } = require('ethers');

// ============= CONFIG =============

const SUPABASE_URL = 'https://nhyodfthiwpwatapeutb.supabase.co';
const SUPABASE_SERVICE_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im5oeW9kZnRoaXdwd2F0YXBldXRiIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc2OTk1MzM2NSwiZXhwIjoyMDg1NTI5MzY1fQ.lVxsQov0BazcZzeo5BwyozpzgrK1iHe3ljX-vfGFgHw';

// Base Mainnet RPC
const BASE_RPC = 'https://mainnet.base.org';

// Subscription Plans
const PLANS = {
    starter: {
        id: 'starter',
        name: 'Starter',
        price: 399,  // €3.99 in cents
        ethAmount: '0.0003',  // ~€0.50 worth of ETH
        txLimit: 50,
        stripePriceId: null  // Set after creating in Stripe
    },
    pro: {
        id: 'pro',
        name: 'Pro',
        price: 999,  // €9.99
        ethAmount: '0.0012',  // ~€2 worth
        txLimit: 200,
        stripePriceId: null
    },
    business: {
        id: 'business',
        name: 'Business',
        price: 2999,  // €29.99
        ethAmount: '0.003',  // ~€5 worth
        txLimit: 500,
        stripePriceId: null
    },
    unlimited: {
        id: 'unlimited',
        name: 'Unlimited',
        price: 4999,  // €49.99
        ethAmount: '0.009',  // ~€15 worth
        txLimit: 1000,  // Soft cap
        stripePriceId: null
    }
};

// ============= SUPABASE HELPERS =============

async function supabaseQuery(endpoint, method = 'GET', body = null) {
    const options = {
        method,
        headers: {
            'apikey': SUPABASE_SERVICE_KEY,
            'Authorization': `Bearer ${SUPABASE_SERVICE_KEY}`,
            'Content-Type': 'application/json',
            'Prefer': method === 'POST' ? 'return=representation' : 'return=minimal'
        }
    };
    if (body) options.body = JSON.stringify(body);
    
    const response = await fetch(`${SUPABASE_URL}/rest/v1/${endpoint}`, options);
    if (!response.ok) {
        throw new Error(`Supabase error: ${response.status}`);
    }
    return method === 'GET' ? response.json() : response;
}

async function getBotById(botId) {
    const bots = await supabaseQuery(`bots?id=eq.${botId}&select=*`);
    return bots[0] || null;
}

async function updateBotSubscription(botId, plan, expiresAt) {
    await supabaseQuery(`bots?id=eq.${botId}`, 'PATCH', {
        subscription_plan: plan,
        subscription_expires: expiresAt,
        tx_remaining: PLANS[plan]?.txLimit || 0
    });
}

async function logTransaction(type, botId, amount, txHash, details = {}) {
    await supabaseQuery('subscription_logs', 'POST', {
        type,
        bot_id: botId,
        amount,
        tx_hash: txHash,
        details,
        created_at: new Date().toISOString()
    });
}

// ============= ETH DISTRIBUTION =============

class TreasuryManager {
    constructor(privateKey) {
        this.provider = new ethers.JsonRpcProvider(BASE_RPC);
        this.wallet = new ethers.Wallet(privateKey, this.provider);
    }

    async getBalance() {
        const balance = await this.provider.getBalance(this.wallet.address);
        return ethers.formatEther(balance);
    }

    async sendEth(toAddress, amountEth) {
        const tx = await this.wallet.sendTransaction({
            to: toAddress,
            value: ethers.parseEther(amountEth)
        });
        await tx.wait();
        return tx.hash;
    }

    async distributeToBot(botId, plan) {
        const bot = await getBotById(botId);
        if (!bot) throw new Error(`Bot ${botId} not found`);
        if (!bot.wallet_address) throw new Error(`Bot ${botId} has no wallet`);

        const planConfig = PLANS[plan];
        if (!planConfig) throw new Error(`Unknown plan: ${plan}`);

        console.log(`💸 Sending ${planConfig.ethAmount} ETH to ${bot.name} (${bot.wallet_address})`);
        
        const txHash = await this.sendEth(bot.wallet_address, planConfig.ethAmount);
        
        // Update bot subscription
        const expiresAt = new Date();
        expiresAt.setMonth(expiresAt.getMonth() + 1);
        await updateBotSubscription(botId, plan, expiresAt.toISOString());
        
        // Log transaction
        await logTransaction('eth_distribution', botId, planConfig.ethAmount, txHash, {
            plan,
            txLimit: planConfig.txLimit
        });

        console.log(`✅ Done! TX: ${txHash}`);
        return txHash;
    }
}

// ============= STRIPE WEBHOOK HANDLER =============

async function handleStripeWebhook(event, treasury) {
    switch (event.type) {
        case 'checkout.session.completed': {
            const session = event.data.object;
            const botId = session.metadata?.bot_id;
            const plan = session.metadata?.plan;

            if (!botId || !plan) {
                console.error('Missing bot_id or plan in session metadata');
                return { error: 'Missing metadata' };
            }

            // Distribute ETH to bot
            const txHash = await treasury.distributeToBot(botId, plan);
            return { success: true, txHash };
        }

        case 'invoice.paid': {
            // Recurring subscription payment
            const invoice = event.data.object;
            const subscriptionId = invoice.subscription;
            
            // Get subscription details from Stripe
            // Then distribute ETH for the new period
            console.log(`📅 Recurring payment for subscription ${subscriptionId}`);
            // TODO: Look up bot from subscription ID and distribute
            return { success: true };
        }

        case 'customer.subscription.deleted': {
            // Subscription cancelled
            const subscription = event.data.object;
            console.log(`❌ Subscription cancelled: ${subscription.id}`);
            // TODO: Update bot subscription status
            return { success: true };
        }

        default:
            console.log(`Unhandled event type: ${event.type}`);
            return { ignored: true };
    }
}

// ============= EXPRESS ROUTES =============

function setupRoutes(app, treasury) {
    const express = require('express');

    // Get subscription plans
    app.get('/api/plans', (req, res) => {
        res.json(PLANS);
    });

    // Create checkout session
    app.post('/api/subscribe', express.json(), async (req, res) => {
        try {
            const { botId, plan } = req.body;
            
            if (!botId || !plan || !PLANS[plan]) {
                return res.status(400).json({ error: 'Invalid request' });
            }

            const bot = await getBotById(botId);
            if (!bot) {
                return res.status(404).json({ error: 'Bot not found' });
            }

            // For now, return Stripe checkout URL placeholder
            // In production, create actual Stripe checkout session
            const checkoutUrl = `https://checkout.stripe.com/pay/${plan}?bot=${botId}`;
            
            res.json({ 
                checkoutUrl,
                plan: PLANS[plan],
                bot: { id: bot.id, name: bot.name }
            });
        } catch (error) {
            console.error('Subscribe error:', error);
            res.status(500).json({ error: error.message });
        }
    });

    // Stripe webhook
    app.post('/api/webhook/stripe', express.raw({ type: 'application/json' }), async (req, res) => {
        const sig = req.headers['stripe-signature'];
        const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET;

        let event;
        try {
            // In production, verify signature with Stripe
            // event = stripe.webhooks.constructEvent(req.body, sig, webhookSecret);
            event = JSON.parse(req.body.toString());
        } catch (err) {
            console.error('Webhook signature verification failed:', err.message);
            return res.status(400).send(`Webhook Error: ${err.message}`);
        }

        try {
            const result = await handleStripeWebhook(event, treasury);
            res.json(result);
        } catch (error) {
            console.error('Webhook handler error:', error);
            res.status(500).json({ error: error.message });
        }
    });

    // Manual distribution (admin only - for testing)
    app.post('/api/admin/distribute', express.json(), async (req, res) => {
        try {
            const { botId, plan, adminKey } = req.body;
            
            // Simple admin auth (use proper auth in production)
            if (adminKey !== process.env.ADMIN_KEY) {
                return res.status(401).json({ error: 'Unauthorized' });
            }

            const txHash = await treasury.distributeToBot(botId, plan);
            res.json({ success: true, txHash });
        } catch (error) {
            console.error('Distribution error:', error);
            res.status(500).json({ error: error.message });
        }
    });

    // Treasury status
    app.get('/api/treasury', async (req, res) => {
        try {
            const balance = await treasury.getBalance();
            res.json({ 
                address: treasury.wallet.address,
                balance: `${balance} ETH`
            });
        } catch (error) {
            res.status(500).json({ error: error.message });
        }
    });
}

// ============= EXPORTS =============

module.exports = {
    PLANS,
    TreasuryManager,
    handleStripeWebhook,
    setupRoutes,
    getBotById,
    updateBotSubscription
};
