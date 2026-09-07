// src/routes/userUpi.js
import { Hono } from 'hono';
import { authMiddleware } from './auth.js';
import { ok, fail, genId } from '../lib/utils.js';

const userUpi = new Hono();

// ✅ GET /api/users/upi - User ke saare saved UPI IDs lao
userUpi.get('/', authMiddleware, async (c) => {
  try {
    const user = c.get('user');
    const { results } = await c.env.DB.prepare(
      'SELECT * FROM user_upi WHERE user_id = ? ORDER BY created_at DESC'
    ).bind(user.id).all();
    
    return ok(c, results || []);
  } catch (err) {
    return fail(c, `Failed to load UPI IDs: ${err.message}`, 500);
  }
});

// ✅ POST /api/users/upi - Naya UPI ID add karo
userUpi.post('/', authMiddleware, async (c) => {
  try {
    const user = c.get('user');
    const body = await c.req.json().catch(() => ({}));
    
    const { upiId, isDefault } = body;
    
    if (!upiId) {
      return fail(c, 'upiId is required.', 400);
    }
    
    // ✅ UPI ID ko validate karo (simple validation)
    if (!upiId.includes('@')) {
      return fail(c, 'Invalid UPI ID. Must contain @.', 400);
    }
    
    const id = genId('upi');
    
    // ✅ Agar default UPI hai, toh pehle sab default hata do
    if (isDefault) {
      await c.env.DB.prepare(
        'UPDATE user_upi SET is_default = 0 WHERE user_id = ?'
      ).bind(user.id).run();
    }
    
    await c.env.DB.prepare(
      `INSERT INTO user_upi 
        (id, user_id, upi_id, is_default, created_at, updated_at)
       VALUES (?, ?, ?, ?, datetime('now'), datetime('now'))`
    )
      .bind(id, user.id, upiId, isDefault ? 1 : 0)
      .run();
    
    return ok(c, { id, upiId, isDefault }, undefined, 201);
  } catch (err) {
    return fail(c, `Failed to add UPI ID: ${err.message}`, 500);
  }
});

// ✅ PUT /api/users/upi/:id - UPI ID update karo
userUpi.put('/:id', authMiddleware, async (c) => {
  try {
    const user = c.get('user');
    const id = c.req.param('id');
    const body = await c.req.json().catch(() => ({}));
    
    const existing = await c.env.DB.prepare(
      'SELECT * FROM user_upi WHERE id = ? AND user_id = ?'
    ).bind(id, user.id).first();
    
    if (!existing) return fail(c, 'UPI ID not found.', 404);
    
    const merged = {
      upi_id: body.upiId ?? existing.upi_id,
      is_default: body.isDefault !== undefined ? (body.isDefault ? 1 : 0) : existing.is_default
    };
    
    // ✅ Agar default UPI update ho raha hai, toh pehle sab default hata do
    if (merged.is_default) {
      await c.env.DB.prepare(
        'UPDATE user_upi SET is_default = 0 WHERE user_id = ?'
      ).bind(user.id).run();
    }
    
    await c.env.DB.prepare(
      `UPDATE user_upi SET upi_id = ?, is_default = ?, updated_at = datetime('now') WHERE id = ?`
    )
      .bind(merged.upi_id, merged.is_default, id)
      .run();
    
    const updated = await c.env.DB.prepare('SELECT * FROM user_upi WHERE id = ?').bind(id).first();
    return ok(c, updated);
  } catch (err) {
    return fail(c, `Failed to update UPI ID: ${err.message}`, 500);
  }
});

// ✅ DELETE /api/users/upi/:id - UPI ID delete karo
userUpi.delete('/:id', authMiddleware, async (c) => {
  try {
    const user = c.get('user');
    const id = c.req.param('id');
    
    const result = await c.env.DB.prepare(
      'DELETE FROM user_upi WHERE id = ? AND user_id = ?'
    ).bind(id, user.id).run();
    
    if (result.meta?.changes === 0) return fail(c, 'UPI ID not found.', 404);
    return ok(c, { id, deleted: true });
  } catch (err) {
    return fail(c, `Failed to delete UPI ID: ${err.message}`, 500);
  }
});

export default userUpi;
