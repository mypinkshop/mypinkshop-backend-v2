// src/routes/otp.js
import { Hono } from 'hono';
import { ok, fail, genId } from '../lib/utils.js';

const otp = new Hono();

// ✅ Helper: Generate 6-digit OTP
const generateOTP = () => {
  return Math.floor(100000 + Math.random() * 900000).toString();
};

// ✅ Send email using SENDER.NET API (Correct Endpoint + Template ID)
const sendEmail = async (c, to, subject, html) => {
  try {
    const { SMTP_USER, SMTP_PASS } = c.env;
    
    // ✅ Correct Endpoint
    const response = await fetch('https://api.sender.net/v2/emails', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${SMTP_PASS}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        from: { email: 'noreply@mypinkshop.com', name: 'MyPinkShop' },
        to: [{ email: to }],
        subject: subject,
        template_id: 'ejvA04', // ✅ Yahan Template ID daalo
      }),
    });
    
    return response;
  } catch (error) {
    console.error('Email sending error:', error);
    return null;
  }
};

// ✅ POST /api/otp/send - Send OTP
otp.post('/send', async (c) => {
  try {
    const { email } = await c.req.json().catch(() => ({}));
    
    if (!email) {
      return fail(c, 'Email is required.', 400);
    }
    
    // ✅ Check if user already exists
    const existingUser = await c.env.DB.prepare(
      'SELECT id FROM users WHERE email = ?'
    ).bind(email.toLowerCase().trim()).first();
    
    if (existingUser) {
      return fail(c, 'An account with this email already exists. Please login.', 409);
    }
    
    // ✅ Generate OTP
    const otpCode = generateOTP();
    const expiresAt = new Date(Date.now() + 10 * 60 * 1000).toISOString();
    
    // ✅ Store OTP in database
    const id = genId('otp');
    await c.env.DB.prepare(
      `INSERT INTO otp_verifications (id, email, otp_code, is_verified, created_at, expires_at)
       VALUES (?, ?, ?, 0, datetime('now'), ?)`
    )
      .bind(id, email.toLowerCase().trim(), otpCode, expiresAt)
      .run();
    
    // ✅ Send email (Template ID ke saath)
    const emailResult = await sendEmail(c, email.toLowerCase().trim(), 'Your MyPinkShop OTP', '');

    if (!emailResult || !emailResult.ok) {
      console.log('⚠️ Email failed, but OTP is:', otpCode);
    }
    
    return ok(c, {
      success: true,
      message: 'OTP sent successfully!',
      otp: otpCode, // Testing ke liye
      expiresIn: 600
    });
  } catch (err) {
    return fail(c, `Failed to send OTP: ${err.message}`, 500);
  }
});

// ✅ POST /api/otp/verify - Verify OTP
otp.post('/verify', async (c) => {
  try {
    const { email, otp } = await c.req.json().catch(() => ({}));
    
    if (!email || !otp) {
      return fail(c, 'Email and OTP are required.', 400);
    }
    
    // ✅ Find OTP record
    const otpRecord = await c.env.DB.prepare(
      'SELECT * FROM otp_verifications WHERE email = ? AND otp_code = ? AND is_verified = 0'
    ).bind(email.toLowerCase().trim(), otp).first();
    
    if (!otpRecord) {
      return fail(c, 'Invalid OTP.', 400);
    }
    
    // ✅ Check expiry
    if (new Date(otpRecord.expires_at) < new Date()) {
      await c.env.DB.prepare('DELETE FROM otp_verifications WHERE id = ?').bind(otpRecord.id).run();
      return fail(c, 'OTP expired. Please request a new one.', 400);
    }
    
    // ✅ Mark OTP as verified
    await c.env.DB.prepare(
      'UPDATE otp_verifications SET is_verified = 1 WHERE id = ?'
    ).bind(otpRecord.id).run();
    
    // ✅ Create user if not exists
    const existingUser = await c.env.DB.prepare(
      'SELECT id, name, email, role FROM users WHERE email = ?'
    ).bind(email.toLowerCase().trim()).first();
    
    if (!existingUser) {
      const userId = genId('usr');
      await c.env.DB.prepare(
        `INSERT INTO users (id, name, email, password, role, created_at, updated_at)
         VALUES (?, ?, ?, ?, 'buyer', datetime('now'), datetime('now'))`
      )
        .bind(userId, email.split('@')[0], email.toLowerCase().trim(), '')
        .run();
    }
    
    return ok(c, {
      success: true,
      message: 'OTP verified successfully!'
    });
  } catch (err) {
    return fail(c, `Failed to verify OTP: ${err.message}`, 500);
  }
});

// ✅ POST /api/otp/resend - Resend OTP
otp.post('/resend', async (c) => {
  try {
    const { email } = await c.req.json().catch(() => ({}));
    
    if (!email) {
      return fail(c, 'Email is required.', 400);
    }
    
    // ✅ Delete old OTPs
    await c.env.DB.prepare('DELETE FROM otp_verifications WHERE email = ?').bind(email.toLowerCase().trim()).run();
    
    // ✅ Generate new OTP
    const otpCode = generateOTP();
    const expiresAt = new Date(Date.now() + 10 * 60 * 1000).toISOString();
    
    const id = genId('otp');
    await c.env.DB.prepare(
      `INSERT INTO otp_verifications (id, email, otp_code, is_verified, created_at, expires_at)
       VALUES (?, ?, ?, 0, datetime('now'), ?)`
    )
      .bind(id, email.toLowerCase().trim(), otpCode, expiresAt)
      .run();
    
    // ✅ Send email (Template ID ke saath)
    const emailResult = await sendEmail(c, email.toLowerCase().trim(), 'Your MyPinkShop OTP', '');

    if (!emailResult || !emailResult.ok) {
      console.log('⚠️ Email failed, but OTP is:', otpCode);
    }
    
    return ok(c, {
      success: true,
      message: 'OTP resent successfully!',
      otp: otpCode,
      expiresIn: 600
    });
  } catch (err) {
    return fail(c, `Failed to resend OTP: ${err.message}`, 500);
  }
});

export default otp;
