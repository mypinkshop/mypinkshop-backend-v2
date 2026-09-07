// src/routes/otp.js
import { Hono } from 'hono';
import { fail, genId } from '../lib/utils.js';
import { signJWT } from '../lib/jwt.js';
// ✅ FIX: this file used to have its own copy-pasted Zoho implementation
// that could silently drift out of sync with src/lib/email.js. Now both
// auth.js (forgot-password) and otp.js share the exact same sender.
import { sendEmail } from '../lib/email.js';

const otp = new Hono();

const generateOTP = () => {
  return Math.floor(100000 + Math.random() * 900000).toString();
};

/**
 * ⚠️ Zoho Mail API requires 5 secrets that were MISSING from wrangler.toml:
 *   ZOHO_CLIENT_ID, ZOHO_CLIENT_SECRET, ZOHO_REFRESH_TOKEN, ZOHO_ACCOUNT_ID,
 *   ZOHO_FROM_EMAIL
 * wrangler.toml only had ZOHO_PASSWORD (unused by this OAuth-based code) and
 * FROM_EMAIL (wrong name). This is why every OTP/reset email was failing.
 * See wrangler.toml comments + README section added for exact setup steps.
 */

// POST /api/otp/send
otp.post('/send', async (c) => {
  try {
    const body = await c.req.json().catch(() => ({}));
    const { email } = body;

    if (!email) return fail(c, 'Email is required.', 400);

    const cleanEmail = String(email).toLowerCase().trim();

    const existingUser = await c.env.DB.prepare('SELECT id FROM users WHERE email = ?').bind(cleanEmail).first();
    if (existingUser) {
      return c.json({ success: false, exists: true, error: 'Account already exists. Please login.' }, 409);
    }

    await c.env.DB.prepare('DELETE FROM otp_verifications WHERE email = ?').bind(cleanEmail).run();

    const otpCode = generateOTP();
    const expiresAt = new Date(Date.now() + 10 * 60 * 1000).toISOString();
    const id = genId('otp');

    await c.env.DB.prepare(
      `INSERT INTO otp_verifications (id, email, otp_code, is_verified, created_at, expires_at) VALUES (?, ?, ?, 0, datetime('now'), ?)`
    ).bind(id, cleanEmail, otpCode, expiresAt).run();

    const emailHtml = `
      <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px;">
        <h2 style="color: #ec4899;">MyPinkShop</h2>
        <p>Your OTP is:</p>
        <h1 style="font-size: 48px; letter-spacing: 10px; color: #ec4899;">${otpCode}</h1>
        <p>This OTP is valid for 10 minutes.</p>
      </div>
    `;

    const emailResult = await sendEmail(c, cleanEmail, 'Your MyPinkShop OTP', emailHtml);
    if (!emailResult.ok) return fail(c, `Email API Error: ${emailResult.error}`, 500);

    return c.json({ success: true, message: 'OTP sent successfully!', expiresIn: 600 });
  } catch (err) {
    return fail(c, `Failed to send OTP: ${err.message}`, 500);
  }
});

// POST /api/otp/verify
otp.post('/verify', async (c) => {
  try {
    const body = await c.req.json().catch(() => ({}));
    const { email, otp } = body;

    if (!email || !otp) return fail(c, 'Email and OTP are required.', 400);

    const cleanEmail = String(email).toLowerCase().trim();
    const cleanOtp = String(otp).trim();

    const otpRecord = await c.env.DB.prepare(
      'SELECT * FROM otp_verifications WHERE email = ? AND otp_code = ?'
    ).bind(cleanEmail, cleanOtp).first();

    if (!otpRecord) return fail(c, 'Invalid OTP.', 400);

    if (new Date(otpRecord.expires_at) < new Date()) {
      await c.env.DB.prepare('DELETE FROM otp_verifications WHERE id = ?').bind(otpRecord.id).run();
      return fail(c, 'OTP expired.', 400);
    }

    await c.env.DB.prepare('UPDATE otp_verifications SET is_verified = 1 WHERE id = ?').bind(otpRecord.id).run();

    const existingUser = await c.env.DB.prepare('SELECT id, name, role FROM users WHERE email = ?').bind(cleanEmail).first();
    let userId = existingUser ? existingUser.id : null;

    if (!existingUser) {
      userId = genId('usr');
      await c.env.DB.prepare(
        `INSERT INTO users (id, name, email, password, role, created_at, updated_at) VALUES (?, ?, ?, ?, 'customer', datetime('now'), datetime('now'))`
      ).bind(userId, cleanEmail.split('@')[0], cleanEmail, '').run();
    }

    // Issue a real, verifiable JWT
    const userName = existingUser?.name || cleanEmail.split('@')[0];
    const userRole = existingUser?.role || 'customer';
    const token = await signJWT(
      { id: userId, email: cleanEmail, role: userRole, name: userName },
      c.env.JWT_SECRET
    );

    return c.json({
      success: true,
      message: 'OTP verified successfully!',
      token: token,
      user: {
        _id: userId,
        name: userName,
        email: cleanEmail,
        role: userRole,
      },
    });
  } catch (err) {
    return fail(c, `Verify Error: ${err.message}`, 500);
  }
});

// POST /api/otp/resend
otp.post('/resend', async (c) => {
  try {
    const body = await c.req.json().catch(() => ({}));
    const { email } = body;

    if (!email) return fail(c, 'Email is required.', 400);

    const cleanEmail = String(email).toLowerCase().trim();

    const existingUser = await c.env.DB.prepare('SELECT id FROM users WHERE email = ?').bind(cleanEmail).first();
    if (existingUser) {
      return c.json({ success: false, exists: true, error: 'Account already exists. Please login.' }, 409);
    }

    await c.env.DB.prepare('DELETE FROM otp_verifications WHERE email = ?').bind(cleanEmail).run();

    const otpCode = generateOTP();
    const expiresAt = new Date(Date.now() + 10 * 60 * 1000).toISOString();
    const id = genId('otp');

    await c.env.DB.prepare(
      `INSERT INTO otp_verifications (id, email, otp_code, is_verified, created_at, expires_at) VALUES (?, ?, ?, 0, datetime('now'), ?)`
    ).bind(id, cleanEmail, otpCode, expiresAt).run();

    const emailHtml = `
      <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px;">
        <h2 style="color: #ec4899;">MyPinkShop</h2>
        <p>Your OTP is:</p>
        <h1 style="font-size: 48px; letter-spacing: 10px; color: #ec4899;">${otpCode}</h1>
      </div>
    `;

    const emailResult = await sendEmail(c, cleanEmail, 'Your MyPinkShop OTP', emailHtml);
    if (!emailResult.ok) return fail(c, `Email API Error: ${emailResult.error}`, 500);

    return c.json({ success: true, message: 'OTP resent successfully!', expiresIn: 600 });
  } catch (err) {
    return fail(c, `Failed to resend OTP: ${err.message}`, 500);
  }
});

export default otp;
