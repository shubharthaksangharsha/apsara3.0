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
      mode: 'subscription', // changed from 'payment' to 'subscription'
      success_url: STRIPE_SUCCESS_URL,
      cancel_url: STRIPE_CANCEL_URL,
    });
    res.json({ url: session.url });
  } catch (err) {
    console.error('Stripe error:', err); // Log the full error object for debugging
    res.status(500).json({ error: err.message });
  }
});

// Success and Cancel routes for Stripe Checkout
router.get('/success', (req, res) => {
  // HTML page with JS to redirect to app deep link, fallback to message
  res.send(`
    <html>
      <head><title>Payment Successful</title></head>
      <body style="font-family:sans-serif;text-align:center;padding-top:60px;">
        <h1>Payment Successful!</h1>
        <p>Thank you for upgrading to Premium.</p>
        <script>
          // Try to open the app via deep link
          window.location = 'apsara://stripe-success';
        </script>
        <p>If you are not redirected, you can close this page and return to the app.</p>
      </body>
    </html>
  `);
});

router.get('/cancel', (req, res) => {
  res.send(`
    <html>
      <head><title>Payment Cancelled</title></head>
      <body style="font-family:sans-serif;text-align:center;padding-top:60px;">
        <h1>Payment Cancelled</h1>
        <p>Your payment was not completed.</p>
        <script>
          window.location = 'apsara://stripe-cancel';
        </script>
        <p>If you are not redirected, you can close this page and return to the app.</p>
      </body>
    </html>
  `);
});

export default router;
