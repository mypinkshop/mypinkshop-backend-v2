// src/services/shiprocket.js

const SHIPROCKET_BASE_URL = 'https://apiv2.shiprocket.in/v1/external';

// 1. Generate Auth Token
export async function getShiprocketToken(env) {
  try {
    const response = await fetch(`${SHIPROCKET_BASE_URL}/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        email: env.SHIPROCKET_EMAIL,
        password: env.SHIPROCKET_PASSWORD,
      }),
    });

    const data = await response.json();
    if (data.token) {
      return data.token;
    }
    throw new Error('Failed to obtain Shiprocket token');
  } catch (error) {
    console.error('Shiprocket Auth Error:', error);
    return null;
  }
}

// 3. Check Pincode Serviceability & Rates (GET API)
export async function checkServiceability(env, pickupPincode, deliveryPincode, weight, cod = 1) {
  const token = await getShiprocketToken(env);
  if (!token) return { success: false, error: 'Auth failed' };

  try {
    const url = `${SHIPROCKET_BASE_URL}/courier/serviceability/?pickup_postcode=${pickupPincode}&delivery_postcode=${deliveryPincode}&weight=${weight}&cod=${cod}`;
    
    const response = await fetch(url, {
      method: 'GET',
      headers: {
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
    });

    const data = await response.json();
    return data;
  } catch (error) {
    console.error('Serviceability Error:', error);
    return { success: false, error: error.message };
  }
}

// 4. Create Order in Shiprocket (POST API)
export async function createShiprocketOrder(env, orderPayload) {
  const token = await getShiprocketToken(env);
  if (!token) return { success: false, error: 'Auth failed' };

  try {
    const response = await fetch(`${SHIPROCKET_BASE_URL}/orders/create/adhoc`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(orderPayload),
    });

    const data = await response.json();
    return data;
  } catch (error) {
    console.error('Create Order Error:', error);
    return { success: false, error: error.message };
  }
}
