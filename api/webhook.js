// api/webhook.js — Vercel serverless function
// Triggered by Lemon Squeezy webhook on successful order.
// Generates a personalized PDF plan via Claude and emails it.
//
// Required environment variables (set in Vercel dashboard):
//   ANTHROPIC_API_KEY   — your Claude API key
//   EMAIL_USER          — your Gmail address (e.g. youremail@gmail.com)
//   EMAIL_PASS          — Gmail App Password (NOT your regular password!)
//   LEMON_SQUEEZY_SECRET — webhook secret from Lemon Squeezy (for verification)

import Anthropic from '@anthropic-ai/sdk';
import nodemailer from 'nodemailer';
import { createHmac } from 'crypto';

// ── Vercel config: allow larger body for webhook payloads ──────────────────
export const config = { api: { bodyParser: true } };

// ── Verify that the request truly came from Lemon Squeezy ─────────────────
function verifySignature(req, rawBody) {
  // Allow manual testing from our test button
  if (req.headers['x-test-mode'] === 'true') return true;

  const secret = process.env.LEMON_SQUEEZY_SECRET;
  if (!secret) return true; // skip if not set (dev mode)
  const sig = req.headers['x-signature'];
  const expected = createHmac('sha256', secret).update(rawBody).digest('hex');
  return sig === expected;
}

// ── Build an HTML page for the plan (will become PDF) ─────────────────────
function wrapHtml(planMarkdown, customerName) {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <style>
    body { font-family: Arial, sans-serif; margin: 40px; color: #1A1A2E; line-height: 1.7; }
    h1 { color: #E8454A; font-size: 28px; text-transform: uppercase; }
    h2 { color: #E8454A; border-bottom: 2px solid #FFE0DD; padding-bottom: 6px; }
    h3 { color: #4A4A6A; }
    .header { background: linear-gradient(135deg, #E8454A, #FF8A6E);
              color: #fff; padding: 30px 40px; margin: -40px -40px 30px;
              text-align: center; }
    .header h1 { color: #fff; margin: 0; }
    .header p { margin: 4px 0 0; opacity: .85; font-size: 14px; }
    .footer { margin-top: 40px; font-size: 11px; color: #aaa; text-align: center;
              border-top: 1px solid #eee; padding-top: 14px; }
  </style>
</head>
<body>
  <div class="header">
    <h1>BILDBODY</h1>
    <p>Your Personal Fitness &amp; Nutrition Plan</p>
    ${customerName ? `<p>Prepared exclusively for <strong>${customerName}</strong></p>` : ''}
  </div>
  ${planMarkdown}
  <div class="footer">© ${new Date().getFullYear()} BildBody · Results may vary · This plan is not medical advice.</div>
</body>
</html>`;
}

// ── Main handler ───────────────────────────────────────────────────────────
export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  // In production you should pass rawBody through a custom middleware,
  // but for simplicity we stringify the parsed body for signature check.
  const rawBody = JSON.stringify(req.body);
  if (!verifySignature(req, rawBody)) {
    return res.status(401).json({ error: 'Invalid signature' });
  }

  // Only handle successful orders
  const eventName = req.headers['x-event-name'];
  if (eventName !== 'order_created') return res.status(200).json({ ok: true, skipped: true });

  const order = req.body?.data?.attributes;
  if (!order) return res.status(400).json({ error: 'Missing order data' });

  const customerEmail = order.user_email || order.customer_email;
  const customerName = order.user_name || 'there';

  // Quiz answers are passed via Lemon Squeezy custom data as a JSON string
  let quizData = {};
  if (order.custom_data && order.custom_data.data) {
    try {
      quizData = JSON.parse(order.custom_data.data);
    } catch (e) {
      console.error("Failed to parse quiz data:", e);
      quizData = order.custom_data;
    }
  } else {
    quizData = order.custom_data || {};
  }

  try {
    // ── 0. Check for required environment variables ─────────────────────
    const apiKey = (process.env.ANTHROPIC_API_KEY || process.env.CLAUDE_API_KEY || "").trim();
    if (!apiKey) throw new Error("Missing ANTHROPIC_API_KEY or CLAUDE_API_KEY on server");
    if (!process.env.EMAIL_USER || !process.env.EMAIL_PASS) throw new Error("Missing email credentials on server");

    // ── 1. Generate the plan with Claude ──────────────────────────────────
    const client = new Anthropic({ apiKey: apiKey });

    const prompt = `You are an expert nutritionist and certified fitness coach.
Generate a detailed, personalized 7-day diet and workout plan in clean HTML format (h2, h3, ul, p tags — no markdown).
Use the following client data:
- Gender: ${quizData[0] || 'Female'}
- Age: ${quizData[1] || '30–39'}
- Main goal: ${quizData[2] || 'Lose Weight'}
- Body type: ${quizData[3] || 'Average'}
- Target areas: ${quizData[4] ? (Array.isArray(quizData[4]) ? quizData[4].join(', ') : quizData[4]) : 'All body'}
- Current weight: ${quizData[5] || '70 kg'}
- Height: ${quizData[6] || '165 cm'}
- Activity level: ${quizData[8] || 'Lightly Active'}
- Daily water intake: ${quizData[9] || '1–2 glasses'}
- Food allergies: ${quizData[10] || 'None'}
- Sleep: ${quizData[11] || '6–7 hours'}
- Stress level: ${quizData[12] || 'Moderate'}
- Meals per day: ${quizData[15] || '3'}

Include:
1. A brief personal introduction (2–3 sentences mentioning their goal and body type).
2. Daily calorie target and macros (protein / carbs / fats).
3. 7-day meal plan table (breakfast, lunch, dinner, snack).
4. 7-day workout schedule with exercise names, sets, reps.
5. Hydration and sleep tips.
6. Motivational closing paragraph.

Keep the tone warm, supportive and motivating.`;

    const message = await client.messages.create({
      model: 'claude-sonnet-4-6',
      max_tokens: 4096,
      messages: [{ role: 'user', content: prompt }],
    });

    const planHtml = wrapHtml(message.content[0].text, customerName);

    // ── 2. Convert HTML → PDF using a lightweight approach ────────────────
    // Vercel serverless functions cannot run Puppeteer (too heavy).
    // We use the free html-pdf-node package which uses Chrome remotely,
    // OR you can use the Browserless.io API (free tier available).
    // For simplicity here we send the HTML as an inline email.
    // Swap the attachment block below with a real PDF library if needed.

    // ── 3. Send email via Gmail (App Password required) ───────────────────
    const transporter = nodemailer.createTransport({
      service: 'gmail',
      auth: {
        user: process.env.EMAIL_USER,
        pass: process.env.EMAIL_PASS, // Gmail App Password
      },
    });

    await transporter.sendMail({
      from: `"BildBody" <${process.env.EMAIL_USER}>`,
      to: customerEmail,
      subject: `🔥 Your Personal BildBody Plan is Ready, ${customerName}!`,
      html: `
        <div style="font-family:Arial,sans-serif;max-width:600px;margin:0 auto;">
          <div style="background:linear-gradient(135deg,#E8454A,#FF8A6E);padding:30px;text-align:center;border-radius:12px 12px 0 0;">
            <h1 style="color:#fff;margin:0;font-size:28px;text-transform:uppercase;">BILDBODY</h1>
            <p style="color:rgba(255,255,255,.85);margin:6px 0 0;">Your Personal Plan Is Ready!</p>
          </div>
          <div style="background:#fff;padding:30px;border:1px solid #eee;border-radius:0 0 12px 12px;">
            <p>Hi <strong>${customerName}</strong> 👋</p>
            <p>Your personalized fitness and nutrition plan has been generated just for you. It is attached to this email as an HTML file — open it in any browser to read and print it.</p>
            <p style="color:#E8454A;font-weight:bold;">Your transformation starts TODAY. You've got this! 💪</p>
            <p style="font-size:12px;color:#aaa;margin-top:24px;">Questions? Reply to this email anytime.<br>© ${new Date().getFullYear()} BildBody</p>
          </div>
        </div>
      `,
      attachments: [
        {
          filename: 'BildBody_Personal_Plan.html',
          content: planHtml,
          contentType: 'text/html',
        },
      ],
    });

    return res.status(200).json({ ok: true, email: customerEmail });
  } catch (err) {
    console.error('Webhook error:', err);
    return res.status(500).json({ error: err.message });
  }
}
