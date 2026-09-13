// src/routes/otp.js
import { Hono } from 'hono';
import { fail, genId } from '../lib/utils.js';
import { signJWT } from '../lib/jwt.js';
import { sendEmail } from '../lib/email.js';

const otp = new Hono();

const generateOTP = () => {
  return Math.floor(100000 + Math.random() * 900000).toString();
};

// ✅ WhatsApp OTP bhejne ka function
const sendWhatsAppOTP = async (c, phone, otpCode) => {
  try {
    const phoneId = c.env.WHATSAPP_PHONE_ID;
    const token = c.env.WHATSAPP_TOKEN;
    const templateName = c.env.WHATSAPP_TEMPLATE_NAME;
    const templateLang = c.env.WHATSAPP_TEMPLATE_LANG || 'en';

    if (!phoneId || !token || !templateName) {
      console.error('WhatsApp credentials missing');
      return { ok: false, error: 'WhatsApp service not configured' };
    }

    const cleanPhone = String(phone).replace(/\D/g, '');
    const fullPhone = cleanPhone.startsWith('91') ? cleanPhone : `91${cleanPhone}`;

    const response = await fetch(
      `https://graph.facebook.com/v21.0/${phoneId}/messages`,
      {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          messaging_product: 'whatsapp',
          to: fullPhone,
          type: 'template',
          template: {
            name: templateName,
            language: { code: templateLang },
            components: [
              {
                type: 'body',
                parameters: [
                  { type: 'text', text: otpCode }
                ]
              }
            ]
          }
        }),
      }
    );

    const data = await response.json();

    if (!response.ok) {
      console.error('WhatsApp API error:', data);
      return { ok: false, error: 'WhatsApp delivery failed' };
    }

    return { ok: true, data };
  } catch (err) {
    console.error('WhatsApp exception:', err);
    return { ok: false, error: 'WhatsApp delivery failed' };
  }
};

// POST /api/otp/send
otp.post('/send', async (c) => {
  try {
    const body = await c.req.json().catch(() => ({}));
    const { email, phone } = body;

    if (!email) return fail(c, 'Email is required.', 400);
    if (!phone) return fail(c, 'Phone number is required.', 400);

    const cleanEmail = String(email).toLowerCase().trim();
    const cleanPhone = String(phone).replace(/\D/g, '');

    await c.env.DB.prepare('DELETE FROM otp_verifications WHERE email = ?').bind(cleanEmail).run();

    const otpCode = generateOTP();
    const expiresAt = new Date(Date.now() + 10 * 60 * 1000).toISOString();
    const id = genId('otp');

    await c.env.DB.prepare(
      `INSERT INTO otp_verifications (id, email, phone, otp_code, is_verified, created_at, expires_at) VALUES (?, ?, ?, ?, 0, datetime('now'), ?)`
    ).bind(id, cleanEmail, cleanPhone, otpCode, expiresAt).run();

    // Email HTML
    const emailHtml = `
      <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px;">
        <h2 style="color: #ec4899;">MyPinkShop</h2>
        <p>Your OTP is:</p>
        <h1 style="font-size: 48px; letter-spacing: 10px; color: #ec4899;">${otpCode}</h1>
        <p>This OTP is valid for 10 minutes.</p>
      </div>
    `;

    // Email aur WhatsApp dono bhejo (independent)
    const emailResult = await sendEmail(c, cleanEmail, 'Your MyPinkShop OTP', emailHtml);
    const waResult = await sendWhatsAppOTP(c, cleanPhone, otpCode);

    // Agar dono fail ho gaye toh error do
    if (!emailResult.ok && !waResult.ok) {
      console.error('Email failed:', emailResult.error);
      console.error('WhatsApp failed:', waResult.error);
      return fail(c, 'Unable to send OTP right now. Please try again in a moment.', 500);
    }

    // Jo successful hua uska message do
    let message = 'OTP sent successfully.';
    if (emailResult.ok && waResult.ok) message = 'OTP sent to your WhatsApp and Email.';
    else if (emailResult.ok) message = 'OTP sent to your Email.';
    else message = 'OTP sent to your WhatsApp.';

    return c.json({ success: true, message, expiresIn: 600 });
  } catch (err) {
    console.error('OTP send error:', err);
    return fail(c, 'Unable to send OTP right now. Please try again in a moment.', 500);
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

    if (!otpRecord) return fail(c, 'Invalid OTP. Please try again.', 400);

    if (new Date(otpRecord.expires_at) < new Date()) {
      await c.env.DB.prepare('DELETE FROM otp_verifications WHERE id = ?').bind(otpRecord.id).run();
      return fail(c, 'OTP has expired. Please request a new one.', 400);
    }

    await c.env.DB.prepare('UPDATE otp_verifications SET is_verified = 1 WHERE id = ?').bind(otpRecord.id).run();

    const existingUser = await c.env.DB.prepare('SELECT id, name, role FROM users WHERE email = ?').bind(cleanEmail).first();
    let userId = existingUser ? existingUser.id : null;

    if (!existingUser) {
      userId = genId('usr');
      await c.env.DB.prepare(
        `INSERT INTO users (id, name, email, phone, password, role, created_at, updated_at) VALUES (?, ?, ?, ?, ?, 'customer', datetime('now'), datetime('now'))`
      ).bind(userId, cleanEmail.split('@')[0], cleanEmail, otpRecord.phone || null, '').run();
    } else if (otpRecord.phone) {
      await c.env.DB.prepare(
        `UPDATE users SET phone = ?, updated_at = datetime('now') WHERE id = ?`
      ).bind(otpRecord.phone, userId).run();
    }

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
    console.error('OTP verify error:', err);
    return fail(c, 'Unable to verify OTP right now. Please try again.', 500);
  }
});

// POST /api/otp/resend
otp.post('/resend', async (c) => {
  try {
    const body = await c.req.json().catch(() => ({}));
    const { email, phone } = body;

    if (!email) return fail(c, 'Email is required.', 400);
    if (!phone) return fail(c, 'Phone number is required.', 400);

    const cleanEmail = String(email).toLowerCase().trim();
    const cleanPhone = String(phone).replace(/\D/g, '');

    await c.env.DB.prepare('DELETE FROM otp_verifications WHERE email = ?').bind(cleanEmail).run();

    const otpCode = generateOTP();
    const expiresAt = new Date(Date.now() + 10 * 60 * 1000).toISOString();
    const id = genId('otp');

    await c.env.DB.prepare(
      `INSERT INTO otp_verifications (id, email, phone, otp_code, is_verified, created_at, expires_at) VALUES (?, ?, ?, ?, 0, datetime('now'), ?)`
    ).bind(id, cleanEmail, cleanPhone, otpCode, expiresAt).run();

    const emailHtml = `
      <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px;">
        <h2 style="color: #ec4899;">MyPinkShop</h2>
        <p>Your OTP is:</p>
        <h1 style="font-size: 48px; letter-spacing: 10px; color: #ec4899;">${otpCode}</h1>
      </div>
    `;

    const emailResult = await sendEmail(c, cleanEmail, 'Your MyPinkShop OTP', emailHtml);
    const waResult = await sendWhatsAppOTP(c, cleanPhone, otpCode);

    if (!emailResult.ok && !waResult.ok) {
      console.error('Email failed:', emailResult.error);
      console.error('WhatsApp failed:', waResult.error);
      return fail(c, 'Unable to resend OTP right now. Please try again in a moment.', 500);
    }

    let message = 'OTP resent successfully.';
    if (emailResult.ok && waResult.ok) message = 'OTP resent to your WhatsApp and Email.';
    else if (emailResult.ok) message = 'OTP resent to your Email.';
    else message = 'OTP resent to your WhatsApp.';

    return c.json({ success: true, message, expiresIn: 600 });
  } catch (err) {
    console.error('OTP resend error:', err);
    return fail(c, 'Unable to resend OTP right now. Please try again in a moment.', 500);
  }
});

export default otp;
