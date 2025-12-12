import express from 'express';
import Stripe from 'stripe';
import dotenv from 'dotenv';
dotenv.config();

const router = express.Router();

const ENABLE_STRIPE_PAYMENT = process.env.ENABLE_STRIPE_PAYMENT === 'true';
const STRIPE_SECRET_KEY = process.env.STRIPE_SECRET_KEY;
const STRIPE_PRICE_ID = process.env.STRIPE_PRICE_ID; // Use a Stripe Price ID for $20 AUD
const STRIPE_SUCCESS_URL = process.env.STRIPE_SUCCESS_URL || 'http://localhost:3000/success';
const STRIPE_CANCEL_URL = process.env.STRIPE_CANCEL_URL || 'http://localhost:3000/cancel';

let stripe = null;
if (ENABLE_STRIPE_PAYMENT && STRIPE_SECRET_KEY) {
  stripe = new Stripe(STRIPE_SECRET_KEY, { apiVersion: '2023-10-16' });
}

// POST /api/stripe/create-checkout-session
router.post('/create-checkout-session', async (req, res) => {
  if (!ENABLE_STRIPE_PAYMENT) {
    return res.status(403).json({ error: 'Stripe payment is disabled.' });
  }
  if (!stripe || !STRIPE_PRICE_ID) {
    return res.status(500).json({ error: 'Stripe is not configured.' });
  }
  try {
    const session = await stripe.checkout.sessions.create({
      payment_method_types: ['card'],
      line_items: [
        {
          price: STRIPE_PRICE_ID,
          quantity: 1,
        },
      ],
      mode: 'payment',
      success_url: STRIPE_SUCCESS_URL,
      cancel_url: STRIPE_CANCEL_URL,
    });
    res.json({ url: session.url });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

export default router;
