// src/routes/otp.js
import { Hono } from 'hono';
import { ok, fail, genId } from '../lib/utils.js';

const otp = new Hono();

const generateOTP = () => {
  return Math.floor(100000 + Math.random() * 900000).toString();
};

// ✅ SENDER.NET API - Correct Endpoint & Payload based on your Dashboard
const sendEmail = async (c, to, subject, html) => {
  try {
    const { SENDER_API_KEY } = c.env;
    
    if (!SENDER_API_KEY) {
      return { ok: false, error: 'SENDER_API_KEY is missing' };
    }

    const response = await fetch('https://api.sender.net/v2/message/send', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${SENDER_API_KEY}`,
        'Content-Type': 'application/json',
        'Accept': 'application/json'
      },
      body: JSON.stringify({
        from: { 
          email: 'noreply@mypinkshop.com', // Agar ye fail ho, toh screenshot wala 'info@mypinkshop.com' try karna
          name: 'MyPinkShop' 
        },
        to: { 
          email: to 
        },
        subject: subject,
        html: html
      })
    });
    
    if (!response.ok) {
      const errorText = await response.text();
      return { ok: false, error: errorText };
    }
    
    return { ok: true };
  } catch (error) {
    return { ok: false, error: error.message };
  }
};

// ✅ POST /api/otp/send
otp.post('/send', async (c) => {
  try {
    const { email } = await c.req.json().catch(() => ({}));
    if (!email) return fail(c, 'Email is required.', 400);
    
    const cleanEmail = String(email).toLowerCase().trim();
    
    const existingUser = await c.env.DB.prepare('SELECT id FROM users WHERE email = ?').bind(cleanEmail).first();
    if (existingUser) return fail(c, 'Account exists. Please login.', 409);
    
    // Purane sabhi unverified OTPs delete kar do taaki conflict na ho
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
    
    return ok(c, { success: true, message: 'OTP sent successfully!', expiresIn: 600 });
  } catch (err) {
    return fail(c, `Failed to send OTP: ${err.message}`, 500);
  }
});

// ✅ POST /api/otp/verify
otp.post('/verify', async (c) => {
  try {
    const { email, otp } = await c.req.json().catch(() => ({}));
    if (!email || !otp) return fail(c, 'Email and OTP are required.', 400);
    
    // Strict Type Casting to prevent Number/String mismatch
    const cleanEmail = String(email).toLowerCase().trim();
    const cleanOtp = String(otp).trim(); 
    
    const otpRecord = await c.env.DB.prepare(
      'SELECT * FROM otp_verifications WHERE email = ? AND otp_code = ? AND is_verified = 0'
    ).bind(cleanEmail, cleanOtp).first();
    
    if (!otpRecord) return fail(c, 'Invalid OTP.', 400);
    
    if (new Date(otpRecord.expires_at) < new Date()) {
      await c.env.DB.prepare('DELETE FROM otp_verifications WHERE id = ?').bind(otpRecord.id).run();
      return fail(c, 'OTP expired.', 400);
    }
    
    await c.env.DB.prepare('UPDATE otp_verifications SET is_verified = 1 WHERE id = ?').bind(otpRecord.id).run();
    
    const existingUser = await c.env.DB.prepare('SELECT id FROM users WHERE email = ?').bind(cleanEmail).first();
    if (!existingUser) {
      const userId = genId('usr');
      await c.env.DB.prepare(
        `INSERT INTO users (id, name, email, password, role, created_at, updated_at) VALUES (?, ?, ?, ?, 'customer', datetime('now'), datetime('now'))`
      ).bind(userId, cleanEmail.split('@')[0], cleanEmail, '').run();
    }
    
    return ok(c, { success: true, message: 'OTP verified successfully!' });
  } catch (err) {
    return fail(c, `Verify Error: ${err.message}`, 500);
  }
});

// ✅ POST /api/otp/resend
otp.post('/resend', async (c) => {
  try {
    const { email } = await c.req.json().catch(() => ({}));
    if (!email) return fail(c, 'Email is required.', 400);
    
    await c.env.DB.prepare('DELETE FROM otp_verifications WHERE email = ?').bind(email.toLowerCase().trim()).run();
    
    const otpCode = generateOTP();
    const expiresAt = new Date(Date.now() + 10 * 60 * 1000).toISOString();
    const id = genId('otp');
    
    await c.env.DB.prepare(
      `INSERT INTO otp_verifications (id, email, otp_code, is_verified, created_at, expires_at) VALUES (?, ?, ?, 0, datetime('now'), ?)`
    ).bind(id, email.toLowerCase().trim(), otpCode, expiresAt).run();
    
    const emailHtml = `
      <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px;">
        <h2 style="color: #ec4899;">MyPinkShop</h2>
        <p>Your OTP is:</p>
        <h1 style="font-size: 48px; letter-spacing: 10px; color: #ec4899;">${otpCode}</h1>
      </div>
    `;
    
    const emailResult = await sendEmail(c, email.toLowerCase().trim(), 'Your MyPinkShop OTP', emailHtml);
    
    if (!emailResult.ok) {
      return fail(c, `Email API Error: ${emailResult.error}`, 500);
    }
    
    return ok(c, { success: true, message: 'OTP resent successfully!', expiresIn: 600 });
  } catch (err) {
    return fail(c, `Failed to resend OTP: ${err.message}`, 500);
  }
});

export default otp;
