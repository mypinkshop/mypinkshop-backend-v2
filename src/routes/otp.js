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
      return { ok: false, error: 'WhatsApp credentials missing' };
    }

    // Phone number clean karo (sirf digits rakho, + hatao)
    const cleanPhone = String(phone).replace(/\D/g, '');

    // India ka number hai toh 91 prefix add karo agar nahi hai
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
              },
              {
                type: 'button',
                sub_type: 'url',
                index: '0',
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
      return { ok: false, error: data?.error?.message || 'WhatsApp send failed' };
    }

    return { ok: true, data };
  } catch (err) {
    console.error('WhatsApp exception:', err);
    return { ok: false, error: err.message };
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

    const existingUser = await c.env.DB.prepare('SELECT id FROM users WHERE email = ?').bind(cleanEmail).first();
    if (existingUser) {
      return c.json({ success: false, exists: true, error: 'Account already exists. Please login.' }, 409);
    }

    await c.env.DB.prepare('DELETE FROM otp_verifications WHERE email = ?').bind(cleanEmail).run();

    const otpCode = generateOTP();
    const expiresAt = new Date(Date.now() + 10 * 60 * 1000).toISOString();
    const id = genId('otp');

    await c.env.DB.prepare(
      `INSERT INTO otp_verifications (id, email, phone, otp_code, is_verified, created_at, expires_at) VALUES (?, ?, ?, ?, 0, datetime('now'), ?)`
    ).bind(id, cleanEmail, cleanPhone, otpCode, expiresAt).run();

    // ✅ Email bhejo
    const emailHtml = `
      <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px;">
        <h2 style="color: #ec4899;">MyPinkShop</h2>
        <p>Your OTP is:</p>
        <h1 style="font-size: 48px; letter-spacing: 10px; color: #ec4899;">${otpCode}</h1>
        <p>This OTP is valid for 10 minutes.</p>
      </div>
    `;
    const emailResult = await sendEmail(c, cleanEmail, 'Your MyPinkShop OTP', emailHtml);

    // ✅ WhatsApp bhejo
    const waResult = await sendWhatsAppOTP(c, cleanPhone, otpCode);

    // Agar dono fail ho gaye toh error do
    if (!emailResult.ok && !waResult.ok) {
      return fail(c, `Email failed: ${emailResult.error}. WhatsApp failed: ${waResult.error}`, 500);
    }

    // Jo bhi successful hua, uska message do
    let message = 'OTP sent successfully!';
    if (emailResult.ok && waResult.ok) message = 'OTP sent to your email and WhatsApp!';
    else if (emailResult.ok) message = 'OTP sent to your email!';
    else message = 'OTP sent to your WhatsApp!';

    return c.json({ success: true, message, expiresIn: 600 });
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
        `INSERT INTO users (id, name, email, phone, password, role, created_at, updated_at) VALUES (?, ?, ?, ?, ?, 'customer', datetime('now'), datetime('now'))`
      ).bind(userId, cleanEmail.split('@')[0], cleanEmail, otpRecord.phone || null, '').run();
    } else if (otpRecord.phone) {
      // Existing user ka phone update karo agar naya hai
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
    return fail(c, `Verify Error: ${err.message}`, 500);
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

    const existingUser = await c.env.DB.prepare('SELECT id FROM users WHERE email = ?').bind(cleanEmail).first();
    if (existingUser) {
      return c.json({ success: false, exists: true, error: 'Account already exists. Please login.' }, 409);
    }

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
      return fail(c, `Email failed: ${emailResult.error}. WhatsApp failed: ${waResult.error}`, 500);
    }

    let message = 'OTP sent successfully!';
    if (emailResult.ok && waResult.ok) message = 'OTP sent to your email and WhatsApp!';
    else if (emailResult.ok) message = 'OTP sent to your email!';
    else message = 'OTP sent to your WhatsApp!';

    return c.json({ success: true, message, expiresIn: 600 });
  } catch (err) {
    return fail(c, `Failed to resend OTP: ${err.message}`, 500);
  }
});

export default otp;
