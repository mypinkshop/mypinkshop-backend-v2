// src/lib/whatsapp.js
// WhatsApp Business API helper — no SDK, pure fetch

const GRAPH_URL = 'https://graph.facebook.com/v21.0';

/* --------------------------------------------------------------------- */
/* Helpers                                                                */
/* --------------------------------------------------------------------- */

/**
 * Normalize phone to WhatsApp format: 91XXXXXXXXXX (no +, no spaces)
 */
function normalizePhone(raw) {
  let digits = String(raw || '').replace(/\D/g, '');
  if (!digits) return '';

  if (digits.length === 10) return '91' + digits;
  if (digits.length === 11 && digits.startsWith('0')) return '91' + digits.slice(1);
  if (digits.length === 12 && digits.startsWith('91')) return digits;

  return digits.slice(-12);
}

function getCreds(env) {
  return {
    phoneId: env.WHATSAPP_PHONE_ID,
    token: env.WHATSAPP_TOKEN,
  };
}

/* --------------------------------------------------------------------- */
/* Order confirmation                                                     */
/* --------------------------------------------------------------------- */

export async function sendOrderNotification(env, to, orderNumber, total) {
  const { phoneId, token } = getCreds(env);

  if (!phoneId || !token) {
    console.warn('⚠️ WhatsApp credentials missing, skipping notification');
    return { success: false, error: 'Missing credentials' };
  }

  const cleanPhone = normalizePhone(to);
  if (!cleanPhone) return { success: false, error: 'Invalid phone number' };

  const payload = {
    messaging_product: 'whatsapp',
    recipient_type: 'individual',
    to: cleanPhone,
    type: 'template',
    template: {
      name: 'order_confirmation',
      language: { code: 'en' },
      components: [
        {
          type: 'body',
          parameters: [
            { type: 'text', text: 'Customer' },
            { type: 'text', text: orderNumber },
            { type: 'text', text: `₹${total}` },
          ],
        },
      ],
    },
  };

  try {
    const res = await fetch(`${GRAPH_URL}/${phoneId}/messages`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify(payload),
    });

    const data = await res.json();

    if (!res.ok) {
      console.error('❌ WhatsApp send failed:', data);
      return { success: false, error: data.error?.message || 'Send failed', data };
    }

    console.log('✅ WhatsApp order sent:', data.messages?.[0]?.id);
    return { success: true, messageId: data.messages?.[0]?.id };
  } catch (err) {
    console.error('❌ WhatsApp error:', err);
    return { success: false, error: err.message };
  }
}

/* --------------------------------------------------------------------- */
/* Password reset                                                         */
/* --------------------------------------------------------------------- */

export async function sendPasswordResetLink(env, to, name, resetToken) {
  const { phoneId, token } = getCreds(env);

  if (!phoneId || !token) {
    console.warn('⚠️ WhatsApp credentials missing, skipping reset message');
    return { success: false, error: 'Missing credentials' };
  }

  const cleanPhone = normalizePhone(to);
  if (!cleanPhone) return { success: false, error: 'Invalid phone number' };

  const payload = {
    messaging_product: 'whatsapp',
    recipient_type: 'individual',
    to: cleanPhone,
    type: 'template',
    template: {
      name: 'password_reset',
      language: { code: 'en' },
      components: [
        {
          type: 'body',
          parameters: [
            { type: 'text', text: name || 'there' },
          ],
        },
        {
          type: 'button',
          sub_type: 'url',
          index: 0,
          parameters: [
            { type: 'text', text: resetToken },
          ],
        },
      ],
    },
  };

  try {
    const res = await fetch(`${GRAPH_URL}/${phoneId}/messages`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify(payload),
    });

    const data = await res.json();

    if (!res.ok) {
      console.error('❌ Reset WhatsApp failed:', data);
      return { success: false, error: data.error?.message || 'Send failed', data };
    }

    console.log('✅ Reset WhatsApp sent:', data.messages?.[0]?.id);
    return { success: true, messageId: data.messages?.[0]?.id };
  } catch (err) {
    console.error('❌ Reset WhatsApp error:', err);
    return { success: false, error: err.message };
  }
}

/* --------------------------------------------------------------------- */
/* Free-form text (24-hour window)                                        */
/* --------------------------------------------------------------------- */

export async function sendTextMessage(env, to, body) {
  const { phoneId, token } = getCreds(env);
  const cleanPhone = normalizePhone(to);

  if (!phoneId || !token || !cleanPhone) {
    return { error: 'Invalid params or missing credentials' };
  }

  try {
    const res = await fetch(`${GRAPH_URL}/${phoneId}/messages`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({
        messaging_product: 'whatsapp',
        to: cleanPhone,
        type: 'text',
        text: { body },
      }),
    });
    return await res.json();
  } catch (err) {
    console.error('❌ WhatsApp text error:', err);
    return { error: err.message };
  }
}
