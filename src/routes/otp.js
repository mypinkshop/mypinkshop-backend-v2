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
// NOTE: now returns the raw Meta API status + response body on failure
// (temporarily) so we can see the ACTUAL rejection reason instead of a
// generic "WhatsApp delivery failed" that hides it.
const sendWhatsAppOTP = async (c, phone, otpCode) => {
  try {
    const phoneId = c.env.WHATSAPP_PHONE_ID;
    const token = c.env.WHATSAPP_TOKEN;
    const templateName = c.env.WHATSAPP_TEMPLATE_NAME;
    const templateLang = c.env.WHATSAPP_TEMPLATE_LANG || 'en';

    if (!phoneId || !token || !templateName) {
      console.error('WhatsApp credentials missing');
      return { ok: false, error: 'WhatsApp service not configured', debug: { configured: false } };
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

    const data = await response.json().catch(() => ({}));

    if (!response.ok) {
      console.error('WhatsApp API error:', JSON.stringify(data));
      return {
        ok: false,
        error: 'WhatsApp delivery failed',
        debug: {
          configured: true,
          metaHttpStatus: response.status,
          metaResponseBody: data,
          fullPhoneUsed: fullPhone,
          templateName,
          templateLang,
        },
      };
    }

    return { ok: true, data };
  } catch (err) {
    console.error('WhatsApp exception:', err);
    return { ok: false, error: 'WhatsApp delivery failed', debug: { configured: true, threw: err.message } };
  }
};

// ============================================================
// POST /api/otp/send
// Login/Signup dono ke liye — email aur phone ke hisaab se
// ============================================================
otp.post('/send', async (c) => {
  try {
    const body = await c.req.json().catch(() => ({}));
    const { email, phone } = body;

    if (!email) return fail(c, 'Email address is required.', 400);
    if (!phone) return fail(c, 'WhatsApp number is required.', 400);

    const cleanEmail = String(email).toLowerCase().trim();
    const cleanPhone = String(phone).replace(/\D/g, '');

    if (cleanPhone.length < 10) {
      return fail(c, 'Please enter a valid 10-digit WhatsApp number.', 400);
    }

    // Phone-based login ke liye check karo
    const isPhoneLogin = cleanEmail.endsWith('@phone.mypinkshop.com');

    // ========== PHONE-BASED LOGIN ==========
    if (isPhoneLogin) {
      // Database mein user dhundho
      const userByPhone = await c.env.DB.prepare(
        'SELECT id, email FROM users WHERE phone = ?'
      ).bind(cleanPhone).first();

      if (!userByPhone) {
        return fail(
          c,
          'No account found with this WhatsApp number. Please create an account first.',
          404
        );
      }

      // OTP generate karo
      await c.env.DB.prepare('DELETE FROM otp_verifications WHERE email = ?').bind(userByPhone.email).run();

      const otpCode = generateOTP();
      const expiresAt = new Date(Date.now() + 10 * 60 * 1000).toISOString();
      const id = genId('otp');

      await c.env.DB.prepare(
        `INSERT INTO otp_verifications (id, email, phone, otp_code, is_verified, created_at, expires_at) VALUES (?, ?, ?, ?, 0, datetime('now'), ?)`
      ).bind(id, userByPhone.email, cleanPhone, otpCode, expiresAt).run();

      // Sirf WhatsApp par bhejo
      const waResult = await sendWhatsAppOTP(c, cleanPhone, otpCode);

      if (!waResult.ok) {
        // ⚠️ TEMPORARY DEBUG INFO — remove once WhatsApp delivery is confirmed working.
        return fail(c, 'Unable to send OTP on WhatsApp right now. Please try again in a moment.', 500, waResult.debug);
      }

      return c.json({
        success: true,
        message: 'OTP sent to your WhatsApp.',
        expiresIn: 600,
      });
    }

    // ========== EMAIL-BASED LOGIN / SIGNUP ==========
    // ✅ FIX: otpCode must be generated BEFORE it's used inside emailHtml —
    // it was previously referenced in the template literal before its own
    // `const otpCode = ...` declaration below, which throws a
    // ReferenceError ("Cannot access 'otpCode' before initialization")
    // the moment anyone tries email-based signup/login.
    await c.env.DB.prepare('DELETE FROM otp_verifications WHERE email = ?').bind(cleanEmail).run();

    const otpCode = generateOTP();
    const expiresAt = new Date(Date.now() + 10 * 60 * 1000).toISOString();
    const id = genId('otp');

    const emailHtml = `
      <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px;">
        <h2 style="color: #ec4899;">MyPinkShop</h2>
        <p>Your OTP is:</p>
        <h1 style="font-size: 48px; letter-spacing: 10px; color: #ec4899;">${otpCode}</h1>
        <p>This OTP is valid for 10 minutes.</p>
      </div>
    `;

    await c.env.DB.prepare(
      `INSERT INTO otp_verifications (id, email, phone, otp_code, is_verified, created_at, expires_at) VALUES (?, ?, ?, ?, 0, datetime('now'), ?)`
    ).bind(id, cleanEmail, cleanPhone, otpCode, expiresAt).run();

    // Email aur WhatsApp dono par bhejo
    const emailResult = await sendEmail(c, cleanEmail, 'Your MyPinkShop OTP', emailHtml);
    const waResult = await sendWhatsAppOTP(c, cleanPhone, otpCode);

    if (!emailResult.ok && !waResult.ok) {
      console.error('Email failed:', emailResult.error);
      console.error('WhatsApp failed:', waResult.error);
      // ⚠️ TEMPORARY DEBUG INFO — remove once delivery is confirmed working.
      return fail(c, 'Unable to send OTP right now. Please try again in a moment.', 500, {
        emailError: emailResult.error,
        whatsappDebug: waResult.debug,
      });
    }

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

// ============================================================
// POST /api/otp/verify
// ============================================================
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

    const existingUser = await c.env.DB.prepare(
      'SELECT id, name, role FROM users WHERE email = ?'
    ).bind(cleanEmail).first();

    if (!existingUser) {
      return fail(c, 'No account found. Please create an account first.', 404);
    }

    const userId = existingUser.id;

    // Phone update karo agar naya hai
    if (otpRecord.phone) {
      await c.env.DB.prepare(
        `UPDATE users SET phone = ?, updated_at = datetime('now') WHERE id = ?`
      ).bind(otpRecord.phone, userId).run();
    }

    const token = await signJWT(
      { id: userId, email: cleanEmail, role: existingUser.role, name: existingUser.name },
      c.env.JWT_SECRET
    );

    return c.json({
      success: true,
      message: 'OTP verified successfully.',
      token: token,
      user: {
        _id: userId,
        name: existingUser.name,
        email: cleanEmail,
        role: existingUser.role,
      },
    });
  } catch (err) {
    console.error('OTP verify error:', err);
    return fail(c, 'Unable to verify OTP right now. Please try again.', 500);
  }
});

// ============================================================
// POST /api/otp/resend
// ============================================================
otp.post('/resend', async (c) => {
  try {
    const body = await c.req.json().catch(() => ({}));
    const { email, phone } = body;

    if (!email) return fail(c, 'Email address is required.', 400);
    if (!phone) return fail(c, 'WhatsApp number is required.', 400);

    const cleanEmail = String(email).toLowerCase().trim();
    const cleanPhone = String(phone).replace(/\D/g, '');

    const isPhoneLogin = cleanEmail.endsWith('@phone.mypinkshop.com');

    // ========== PHONE-BASED RESEND ==========
    if (isPhoneLogin) {
      const userByPhone = await c.env.DB.prepare(
        'SELECT id, email FROM users WHERE phone = ?'
      ).bind(cleanPhone).first();

      if (!userByPhone) {
        return fail(c, 'No account found with this WhatsApp number. Please create an account first.', 404);
      }

      await c.env.DB.prepare('DELETE FROM otp_verifications WHERE email = ?').bind(userByPhone.email).run();

      const otpCode = generateOTP();
      const expiresAt = new Date(Date.now() + 10 * 60 * 1000).toISOString();
      const id = genId('otp');

      await c.env.DB.prepare(
        `INSERT INTO otp_verifications (id, email, phone, otp_code, is_verified, created_at, expires_at) VALUES (?, ?, ?, ?, 0, datetime('now'), ?)`
      ).bind(id, userByPhone.email, cleanPhone, otpCode, expiresAt).run();

      const waResult = await sendWhatsAppOTP(c, cleanPhone, otpCode);

      if (!waResult.ok) {
        // ⚠️ TEMPORARY DEBUG INFO — remove once WhatsApp delivery is confirmed working.
        return fail(c, 'Unable to send OTP on WhatsApp right now. Please try again in a moment.', 500, waResult.debug);
      }

      return c.json({
        success: true,
        message: 'OTP resent to your WhatsApp.',
        expiresIn: 600,
      });
    }

    // ========== EMAIL-BASED RESEND ==========
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
      // ⚠️ TEMPORARY DEBUG INFO — remove once delivery is confirmed working.
      return fail(c, 'Unable to resend OTP right now. Please try again in a moment.', 500, {
        emailError: emailResult.error,
        whatsappDebug: waResult.debug,
      });
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
