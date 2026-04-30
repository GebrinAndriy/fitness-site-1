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

    const prompt = `You are an expert nutritionist and fitness coach.
Generate a concise but complete 7-day personal diet and workout plan for ${customerName}.
User Data:
- Goal: ${quizData[2] || 'Weight Loss'}
- Weight: ${quizData[5] || '70kg'}, Height: ${quizData[6] || '165cm'}
- Activity: ${quizData[8] || 'Active'}

IMPORTANT: 
- Provide exactly 7 days of meals and a 4-day workout cycle.
- Keep descriptions short to fit the response limit.
- Use plain text with clear headers (e.g., DAY 1, MEALS, WORKOUT). 
- Do NOT use HTML tags or markdown code blocks.`;

    const message = await client.messages.create({
      model: 'claude-sonnet-4-6',
      max_tokens: 3500,
      messages: [{ role: 'user', content: prompt }],
    });

    const planText = message.content[0].text.trim();

    // ── 2. Generate PDF using PDFKit ──────────────────────────────────────
    const PDFDocument = require('pdfkit');
    const doc = new PDFDocument({ margin: 50 });
    let buffers = [];
    doc.on('data', buffers.push.bind(buffers));
    
    const pdfPromise = new Promise((resolve) => {
      doc.on('end', () => {
        resolve(Buffer.concat(buffers));
      });
    });

    // Design the PDF
    doc.fillColor('#E8454A').fontSize(26).text('BILDBODY', { align: 'center' });
    doc.fillColor('#333333').fontSize(14).text('YOUR PERSONAL TRANSFORMATION PLAN', { align: 'center' });
    doc.moveDown();
    doc.fillColor('#000000').fontSize(18).text(`Prepared for: ${customerName}`, { align: 'left' });
    doc.moveDown();
    doc.fontSize(12).lineGap(4).text(planText);
    doc.end();

    const pdfBuffer = await pdfPromise;

    // ── 3. Send email ───────────────────
    const transporter = nodemailer.createTransport({
      service: 'gmail',
      auth: {
        user: process.env.EMAIL_USER,
        pass: process.env.EMAIL_PASS,
      },
    });

    await transporter.sendMail({
      from: `"BildBody Fitness" <${process.env.EMAIL_USER}>`,
      to: customerEmail,
      subject: `🔥 Your 7-Day Personal Plan is Ready, ${customerName}!`,
      html: `
        <div style="font-family:Arial,sans-serif;max-width:600px;margin:0 auto;border:1px solid #eee;border-radius:12px;overflow:hidden;background:#fff;">
          <div style="background:linear-gradient(135deg,#E8454A,#FF8A6E);padding:40px 20px;text-align:center;">
            <h1 style="color:#fff;margin:0;font-size:32px;">BILDBODY</h1>
          </div>
          <div style="padding:30px;line-height:1.6;color:#333;">
            <p style="font-size:18px;">Hi <strong>${customerName}</strong>! 👋</p>
            <p>We have finished creating your custom 7-day fitness and nutrition strategy.</p>
            <p style="background:#f0fdf4;padding:15px;border-left:4px solid #10B981;border-radius:4px;color:#166534;">
              ✅ <strong>Your PDF Plan is attached!</strong><br>
              Open the attached file to see your full schedule. You can save it to your phone or print it.
            </p>
            <p>We are excited to see your progress!</p>
          </div>
          <div style="background:#f4f4f4;padding:20px;text-align:center;font-size:12px;color:#888;">
            <p>© 2026 BildBody Fitness. All rights reserved.</p>
          </div>
        </div>
      `,
      attachments: [
        {
          filename: `BildBody_Plan_${customerName}.pdf`,
          content: pdfBuffer,
          contentType: 'application/pdf'
        }
      ]
    });

    return res.status(200).json({ ok: true, email: customerEmail });
  } catch (err) {
    console.error('Webhook error:', err);
    return res.status(500).json({ error: err.message });
  }
}
