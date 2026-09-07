// src/lib/email.js
//
// Zoho Mail API integration, shared by any route that needs to send email
// (OTP verification, password reset, order confirmations, etc).
//
// Zoho uses OAuth2 (no static API key), so every send first exchanges the
// long-lived refresh token for a short-lived access token, then calls the
// "send an email" endpoint with it.
//
// Required secrets (set via Cloudflare Dashboard → Settings → Variables and
// Secrets, with "Encrypt" turned ON so they survive every deploy):
//   ZOHO_CLIENT_ID       - from the Self Client in Zoho API Console
//   ZOHO_CLIENT_SECRET   - from the Self Client in Zoho API Console
//   ZOHO_REFRESH_TOKEN   - obtained once via the authorization_code exchange
//   ZOHO_ACCOUNT_ID      - your Zoho Mail accountId (from GET /api/accounts)
//
// ZOHO_FROM_EMAIL is not sensitive and lives in wrangler.toml [vars] instead.
//
// This project's Zoho account is on the India (.in) data center. If you
// ever migrate, update these two hosts to match (.com / .eu / .in).
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

/**
 * Send an email via Zoho Mail.
 * @returns {{ ok: true } | { ok: false, error: string }}
 */
export async function sendEmail(c, to, subject, html) {
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
}
