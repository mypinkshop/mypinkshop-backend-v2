// src/routes/addresses.js
import { Hono } from 'hono';
import { authMiddleware } from './auth.js';
import { ok, fail, genId } from '../lib/utils.js';

const addresses = new Hono();

// ✅ GET /api/users/addresses - User ke saare addresses lao
addresses.get('/', authMiddleware, async (c) => {
  try {
    const user = c.get('user');
    const { results } = await c.env.DB.prepare(
      'SELECT * FROM user_addresses WHERE user_id = ? ORDER BY created_at DESC'
    ).bind(user.id).all();
    
    return ok(c, results || []);
  } catch (err) {
    return fail(c, `Failed to load addresses: ${err.message}`, 500);
  }
});

// ✅ POST /api/users/addresses - Naya address add karo
addresses.post('/', authMiddleware, async (c) => {
  try {
    const user = c.get('user');
    const body = await c.req.json().catch(() => ({}));
    
    const { name, phone, line1, line2, city, state, pincode, isDefault } = body;
    
    if (!name || !phone || !line1 || !city || !state || !pincode) {
      return fail(c, 'name, phone, line1, city, state, pincode are required.', 400);
    }
    
    const id = genId('addr');
    
    // ✅ Agar default address hai, toh pehle wale sab default hata do
    if (isDefault) {
      await c.env.DB.prepare(
        'UPDATE user_addresses SET is_default = 0 WHERE user_id = ?'
      ).bind(user.id).run();
    }
    
    await c.env.DB.prepare(
      `INSERT INTO user_addresses 
        (id, user_id, name, phone, line1, line2, city, state, pincode, is_default, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'), datetime('now'))`
    )
      .bind(id, user.id, name, phone, line1, line2 || '', city, state, pincode, isDefault ? 1 : 0)
      .run();
    
    return ok(c, { id, ...body }, undefined, 201);
  } catch (err) {
    return fail(c, `Failed to add address: ${err.message}`, 500);
  }
});

// ✅ PUT /api/users/addresses/:id - Address update karo
addresses.put('/:id', authMiddleware, async (c) => {
  try {
    const user = c.get('user');
    const id = c.req.param('id');
    const body = await c.req.json().catch(() => ({}));
    
    const existing = await c.env.DB.prepare(
      'SELECT * FROM user_addresses WHERE id = ? AND user_id = ?'
    ).bind(id, user.id).first();
    
    if (!existing) return fail(c, 'Address not found.', 404);
    
    const merged = {
      name: body.name ?? existing.name,
      phone: body.phone ?? existing.phone,
      line1: body.line1 ?? existing.line1,
      line2: body.line2 ?? existing.line2,
      city: body.city ?? existing.city,
      state: body.state ?? existing.state,
      pincode: body.pincode ?? existing.pincode,
      is_default: body.isDefault !== undefined ? (body.isDefault ? 1 : 0) : existing.is_default
    };
    
    // ✅ Agar default address update ho raha hai, toh pehle sab default hata do
    if (merged.is_default) {
      await c.env.DB.prepare(
        'UPDATE user_addresses SET is_default = 0 WHERE user_id = ?'
      ).bind(user.id).run();
    }
    
    await c.env.DB.prepare(
      `UPDATE user_addresses SET name = ?, phone = ?, line1 = ?, line2 = ?, city = ?, state = ?, pincode = ?, is_default = ?, updated_at = datetime('now') WHERE id = ?`
    )
      .bind(merged.name, merged.phone, merged.line1, merged.line2, merged.city, merged.state, merged.pincode, merged.is_default, id)
      .run();
    
    const updated = await c.env.DB.prepare('SELECT * FROM user_addresses WHERE id = ?').bind(id).first();
    return ok(c, updated);
  } catch (err) {
    return fail(c, `Failed to update address: ${err.message}`, 500);
  }
});

// ✅ PUT/PATCH /api/users/addresses/:id/default - Address ko default banao
const setDefaultAddressHandler = async (c) => {
  try {
    const user = c.get('user');
    const id = c.req.param('id');

    const existing = await c.env.DB.prepare(
      'SELECT * FROM user_addresses WHERE id = ? AND user_id = ?'
    ).bind(id, user.id).first();

    if (!existing) return fail(c, 'Address not found.', 404);

    await c.env.DB.prepare(
      'UPDATE user_addresses SET is_default = 0 WHERE user_id = ?'
    ).bind(user.id).run();

    await c.env.DB.prepare(
      `UPDATE user_addresses SET is_default = 1, updated_at = datetime('now') WHERE id = ?`
    ).bind(id).run();

    const updated = await c.env.DB.prepare('SELECT * FROM user_addresses WHERE id = ?').bind(id).first();
    return ok(c, updated);
  } catch (err) {
    return fail(c, `Failed to set default address: ${err.message}`, 500);
  }
};
addresses.put('/:id/default', authMiddleware, setDefaultAddressHandler);
addresses.patch('/:id/default', authMiddleware, setDefaultAddressHandler);

// ✅ DELETE /api/users/addresses/:id - Address delete karo
addresses.delete('/:id', authMiddleware, async (c) => {
  try {
    const user = c.get('user');
    const id = c.req.param('id');
    
    const result = await c.env.DB.prepare(
      'DELETE FROM user_addresses WHERE id = ? AND user_id = ?'
    ).bind(id, user.id).run();
    
    if (result.meta?.changes === 0) return fail(c, 'Address not found.', 404);
    return ok(c, { id, deleted: true });
  } catch (err) {
    return fail(c, `Failed to delete address: ${err.message}`, 500);
  }
});

export default addresses;
