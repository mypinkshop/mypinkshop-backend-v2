// src/routes/otp.js
import { Hono } from 'hono';
import { fail, genId } from '../lib/utils.js';

const otp = new Hono();

const generateOTP = () => {
  return Math.floor(100000 + Math.random() * 900000).toString();
};

/**
 * Zoho Mail API integration.
 *
 * Zoho uses OAuth2 (no static API key), so every send first exchanges the
 * long-lived refresh token for a short-lived access token, then calls the
 * "send an email" endpoint with it.
 *
 * Required secrets (wrangler secret put <NAME>):
 *   ZOHO_CLIENT_ID       - from the Self Client in Zoho API Console
 *   ZOHO_CLIENT_SECRET    - from the Self Client in Zoho API Console
 *   ZOHO_REFRESH_TOKEN    - obtained once via the authorization_code exchange
 *   ZOHO_ACCOUNT_ID       - your Zoho Mail accountId (from GET /api/accounts)
 *   ZOHO_FROM_EMAIL       - the mailbox you're sending from, e.g. noreply@mypinkshop.com
 *
 * If your Zoho login is on a different data center (US/.com, EU/.eu),
 * change ZOHO_ACCOUNTS_HOST / ZOHO_MAIL_HOST below to match.
 */
const ZOHO_ACCOUNTS_HOST = 'https://accounts.zoho.in';
const ZOHO_MAIL_HOST = 'https://mail.zoho.in';

async function getZohoAccessToken(c) {
  const params = new URLSearchParams({
    refresh_token: c.env.ZOHO_REFRESH_TOKEN,
    client_id: c.env.ZOHO_CLIENT_ID,
    client_secret: c.env.ZOHO_CLIENT_SECRET,
    grant_type: 'refresh_token',
  });

  const response = await fetch(`${ZOHO_ACCOUNTS_HOST}/oauth/v2/token?${params.toString()}`, {
    method: 'POST',
  });

  const data = await response.json().catch(() => ({}));

  if (!response.ok || !data.access_token) {
    throw new Error(`Zoho token refresh failed: ${JSON.stringify(data)}`);
  }

  return data.access_token;
}

const sendEmail = async (c, to, subject, html) => {
  try {
    const accessToken = await getZohoAccessToken(c);

    const response = await fetch(
      `${ZOHO_MAIL_HOST}/api/accounts/${c.env.ZOHO_ACCOUNT_ID}/messages`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Zoho-oauthtoken ${accessToken}`,
        },
        body: JSON.stringify({
          fromAddress: c.env.ZOHO_FROM_EMAIL,
          toAddress: to,
          subject,
          content: html,
          mailFormat: 'html',
        }),
      }
    );

    const data = await response.json().catch(() => ({}));

    if (!response.ok || data?.status?.code !== 200) {
      return { ok: false, error: `Zoho Error (${response.status}): ${JSON.stringify(data)}` };
    }

    return { ok: true };
  } catch (error) {
    return { ok: false, error: `Fetch Exception: ${error.message}` };
  }
};

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

    const existingUser = await c.env.DB.prepare('SELECT id FROM users WHERE email = ?').bind(cleanEmail).first();
    let userId = existingUser ? existingUser.id : null;

    if (!existingUser) {
      userId = genId('usr');
      await c.env.DB.prepare(
        `INSERT INTO users (id, name, email, password, role, created_at, updated_at) VALUES (?, ?, ?, ?, 'customer', datetime('now'), datetime('now'))`
      ).bind(userId, cleanEmail.split('@')[0], cleanEmail, '').run();
    }

    // Generate a simple auth token or success payload matching frontend expectations
    const token = genId('tok');

    // NOTE: returned as a flat object (not wrapped via ok()) because the
    // frontend reads o.token / o.user directly off the top-level response.
    return c.json({
      success: true,
      message: 'OTP verified successfully!',
      token: token,
      user: {
        _id: userId,
        name: cleanEmail.split('@')[0],
        email: cleanEmail,
        role: 'customer',
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
