// src/lib/whatsapp.js
// WhatsApp Business API helper — no SDK, pure fetch

const GRAPH_URL = 'https://graph.facebook.com/v21.0';

/**
 * Order confirmation template bhejo
 * Meta Dashboard pe template name: order_confirmation
 * Template body: "Hi {{1}}, your order {{2}} of {{3}} is confirmed!"
 */
export async function sendOrderNotification(env, to, orderNumber, total) {
  const phoneId = env.WHATSAPP_PHONE_NUMBER_ID;
  const token = env.WHATSAPP_API_TOKEN;

  if (!phoneId || !token) {
    console.warn('⚠️ WhatsApp credentials missing, skipping notification');
    return { success: false, error: 'Missing credentials' };
  }

  // ✅ Phone number format — no + prefix
  const cleanPhone = String(to).replace(/\D/g, '').slice(-10);

  const payload = {
    messaging_product: 'whatsapp',
    recipient_type: 'individual',
    to: cleanPhone,
    type: 'template',
    template: {
      name: 'order_confirmation',        // ✅ Meta pe approved template name
      language: { code: 'en' },
      components: [
        {
          type: 'body',
          parameters: [
            { type: 'text', text: 'Customer' },           // {{1}} — name
            { type: 'text', text: orderNumber },          // {{2}} — MPS-09-...
            { type: 'text', text: `₹${total}` },          // {{3}} — amount
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
      return { success: false, error: data.error?.message || 'Send failed' };
    }

    console.log('✅ WhatsApp message sent:', data.messages?.[0]?.id);
    return { success: true, messageId: data.messages?.[0]?.id };
  } catch (err) {
    console.error('❌ WhatsApp error:', err);
    return { success: false, error: err.message };
  }
}

/**
 * Simple text message (24-hour window ke andar)
 */
export async function sendTextMessage(env, to, body) {
  const phoneId = env.WHATSAPP_PHONE_NUMBER_ID;
  const token = env.WHATSAPP_API_TOKEN;
  const cleanPhone = String(to).replace(/\D/g, '').slice(-10);

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
