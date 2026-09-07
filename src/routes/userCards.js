// src/routes/userCards.js
import { Hono } from 'hono';
import { authMiddleware } from './auth.js';
import { ok, fail, genId } from '../lib/utils.js';

const userCards = new Hono();

// ✅ GET /api/users/cards - User ke saare saved cards lao
userCards.get('/', authMiddleware, async (c) => {
  try {
    const user = c.get('user');
    const { results } = await c.env.DB.prepare(
      'SELECT * FROM user_cards WHERE user_id = ? ORDER BY created_at DESC'
    ).bind(user.id).all();
    
    return ok(c, results || []);
  } catch (err) {
    return fail(c, `Failed to load cards: ${err.message}`, 500);
  }
});

// ✅ POST /api/users/cards - Naya card add karo
userCards.post('/', authMiddleware, async (c) => {
  try {
    const user = c.get('user');
    const body = await c.req.json().catch(() => ({}));
    
    // ✅ FIX: the frontend form (correctly, for PCI-safety) only ever
    // collects the last 4 digits directly — it never asks for or sends a
    // full card number, cardHolderName or CVV. Accept `last4` directly,
    // while still supporting `cardNumber` for any older/other caller.
    const { cardNumber, cardHolderName, last4: rawLast4, expiryMonth, expiryYear, isDefault } = body;

    const last4 = rawLast4 || (cardNumber ? String(cardNumber).slice(-4) : null);

    if (!last4 || last4.length !== 4 || !expiryMonth || !expiryYear) {
      return fail(c, 'last4 (4 digits), expiryMonth, expiryYear are required.', 400);
    }
    
    const id = genId('card');
    
    // ✅ Agar default card hai, toh pehle sab default hata do
    if (isDefault) {
      await c.env.DB.prepare(
        'UPDATE user_cards SET is_default = 0 WHERE user_id = ?'
      ).bind(user.id).run();
    }
    
    await c.env.DB.prepare(
      `INSERT INTO user_cards 
        (id, user_id, card_last4, card_holder_name, expiry_month, expiry_year, is_default, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, datetime('now'), datetime('now'))`
    )
      .bind(id, user.id, last4, cardHolderName || '', expiryMonth, expiryYear, isDefault ? 1 : 0)
      .run();
    
    return ok(c, { id, last4, cardHolderName: cardHolderName || '', expiryMonth, expiryYear, isDefault }, undefined, 201);
  } catch (err) {
    return fail(c, `Failed to add card: ${err.message}`, 500);
  }
});

// ✅ PUT /api/users/cards/:id - Card update karo
userCards.put('/:id', authMiddleware, async (c) => {
  try {
    const user = c.get('user');
    const id = c.req.param('id');
    const body = await c.req.json().catch(() => ({}));
    
    const existing = await c.env.DB.prepare(
      'SELECT * FROM user_cards WHERE id = ? AND user_id = ?'
    ).bind(id, user.id).first();
    
    if (!existing) return fail(c, 'Card not found.', 404);
    
    const merged = {
      card_holder_name: body.cardHolderName ?? existing.card_holder_name,
      expiry_month: body.expiryMonth ?? existing.expiry_month,
      expiry_year: body.expiryYear ?? existing.expiry_year,
      is_default: body.isDefault !== undefined ? (body.isDefault ? 1 : 0) : existing.is_default
    };
    
    // ✅ Agar default card update ho raha hai, toh pehle sab default hata do
    if (merged.is_default) {
      await c.env.DB.prepare(
        'UPDATE user_cards SET is_default = 0 WHERE user_id = ?'
      ).bind(user.id).run();
    }
    
    await c.env.DB.prepare(
      `UPDATE user_cards SET card_holder_name = ?, expiry_month = ?, expiry_year = ?, is_default = ?, updated_at = datetime('now') WHERE id = ?`
    )
      .bind(merged.card_holder_name, merged.expiry_month, merged.expiry_year, merged.is_default, id)
      .run();
    
    const updated = await c.env.DB.prepare('SELECT * FROM user_cards WHERE id = ?').bind(id).first();
    return ok(c, updated);
  } catch (err) {
    return fail(c, `Failed to update card: ${err.message}`, 500);
  }
});

// ✅ DELETE /api/users/cards/:id - Card delete karo
userCards.delete('/:id', authMiddleware, async (c) => {
  try {
    const user = c.get('user');
    const id = c.req.param('id');
    
    const result = await c.env.DB.prepare(
      'DELETE FROM user_cards WHERE id = ? AND user_id = ?'
    ).bind(id, user.id).run();
    
    if (result.meta?.changes === 0) return fail(c, 'Card not found.', 404);
    return ok(c, { id, deleted: true });
  } catch (err) {
    return fail(c, `Failed to delete card: ${err.message}`, 500);
  }
});

export default userCards;
