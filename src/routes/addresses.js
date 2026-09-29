// src/routes/addresses.js
import { Hono } from 'hono';
import { authMiddleware } from './auth.js';
import { ok, fail, genId } from '../lib/utils.js';

const addresses = new Hono();

/* --------------------------------------------------------------------- */
/* Helper: Normalize string for comparison                                */
/* --------------------------------------------------------------------- */
function normalize(str) {
  return (str || '').toString().trim().toLowerCase();
}

/* --------------------------------------------------------------------- */
/* Helper: Body se is_default nikaalo (camelCase + snake_case support)   */
/* --------------------------------------------------------------------- */
function getIsDefault(body) {
  if (body.isDefault !== undefined) return Boolean(body.isDefault);
  if (body.is_default !== undefined) return Boolean(body.is_default);
  return undefined; // undefined = "koi change nahi"
}

/* --------------------------------------------------------------------- */
/* GET /api/users/addresses - User ke saare addresses lao                 */
/* --------------------------------------------------------------------- */
addresses.get('/', authMiddleware, async (c) => {
  try {
    const user = c.get('user');
    const { results } = await c.env.DB.prepare(
      'SELECT * FROM user_addresses WHERE user_id = ? ORDER BY is_default DESC, created_at DESC'
    )
      .bind(user.id)
      .all();

    return ok(c, results || []);
  } catch (err) {
    return fail(c, `Failed to load addresses: ${err.message}`, 500);
  }
});

/* --------------------------------------------------------------------- */
/* POST /api/users/addresses - Naya address add karo                     */
/* ✅ FIXED: isDefault + is_default dono accept karta hai                */
/* ✅ FIXED: Duplicate mile toh UPDATE karo (purani row return mat karo) */
/* --------------------------------------------------------------------- */
addresses.post('/', authMiddleware, async (c) => {
  try {
    const user = c.get('user');
    const body = await c.req.json().catch(() => ({}));

    const { name, phone, line1, line2, city, state, pincode } = body;
    // ✅ FIX #1: dono formats accept karo
    const isDefault = getIsDefault(body) ?? false;

    if (!name || !phone || !line1 || !city || !state || !pincode) {
      return fail(c, 'name, phone, line1, city, state, pincode are required.', 400);
    }

    // ✅ DUPLICATE CHECK
    const existing = await c.env.DB.prepare(
      `SELECT * FROM user_addresses
       WHERE user_id = ?
         AND LOWER(TRIM(name)) = ?
         AND TRIM(phone) = ?
         AND LOWER(TRIM(line1)) = ?
         AND TRIM(pincode) = ?
       LIMIT 1`
    )
      .bind(
        user.id,
        normalize(name),
        (phone || '').toString().trim(),
        normalize(line1),
        (pincode || '').toString().trim()
      )
      .first();

    // ✅ FIX #2: Duplicate mile toh UPDATE karo, purani row return mat karo
    if (existing) {
      console.log('⏭️ Duplicate address — updating existing row instead');

      if (isDefault && existing.is_default !== 1) {
        // Pehle sab defaults hatao
        await c.env.DB.prepare(
          'UPDATE user_addresses SET is_default = 0 WHERE user_id = ?'
        )
          .bind(user.id)
          .run();

        // Phir isko default banao
        await c.env.DB.prepare(
          `UPDATE user_addresses SET is_default = 1, updated_at = datetime('now') WHERE id = ? AND user_id = ?`
        )
          .bind(existing.id, user.id)
          .run();
      }

      const refreshed = await c.env.DB.prepare(
        'SELECT * FROM user_addresses WHERE id = ?'
      )
        .bind(existing.id)
        .first();

      return ok(c, refreshed, undefined, 200);
    }

    // ✅ NAYA ADDRESS INSERT
    const id = genId('addr');

    if (isDefault) {
      await c.env.DB.prepare(
        'UPDATE user_addresses SET is_default = 0 WHERE user_id = ?'
      )
        .bind(user.id)
        .run();
    }

    await c.env.DB.prepare(
      `INSERT INTO user_addresses
        (id, user_id, name, phone, line1, line2, city, state, pincode, is_default, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'), datetime('now'))`
    )
      .bind(
        id,
        user.id,
        name,
        phone,
        line1,
        line2 || '',
        city,
        state,
        pincode,
        isDefault ? 1 : 0
      )
      .run();

    const saved = await c.env.DB.prepare('SELECT * FROM user_addresses WHERE id = ?')
      .bind(id)
      .first();

    return ok(c, saved, undefined, 201);
  } catch (err) {
    return fail(c, `Failed to add address: ${err.message}`, 500);
  }
});

/* --------------------------------------------------------------------- */
/* PUT /api/users/addresses/:id - Address update karo                     */
/* ✅ FIXED: isDefault + is_default dono accept karta hai                */
/* --------------------------------------------------------------------- */
addresses.put('/:id', authMiddleware, async (c) => {
  try {
    const user = c.get('user');
    const id = c.req.param('id');
    const body = await c.req.json().catch(() => ({}));

    const existing = await c.env.DB.prepare(
      'SELECT * FROM user_addresses WHERE id = ? AND user_id = ?'
    )
      .bind(id, user.id)
      .first();

    if (!existing) return fail(c, 'Address not found.', 404);

    // ✅ FIX #1: dono formats accept karo
    const isDefaultInput = getIsDefault(body);

    const merged = {
      name: body.name ?? existing.name,
      phone: body.phone ?? existing.phone,
      line1: body.line1 ?? existing.line1,
      line2: body.line2 ?? existing.line2,
      city: body.city ?? existing.city,
      state: body.state ?? existing.state,
      pincode: body.pincode ?? existing.pincode,
      is_default:
        isDefaultInput !== undefined
          ? isDefaultInput
            ? 1
            : 0
          : existing.is_default,
    };

    // ✅ DUPLICATE CHECK (different id pe same address)
    const duplicate = await c.env.DB.prepare(
      `SELECT id FROM user_addresses
       WHERE user_id = ?
         AND id != ?
         AND LOWER(TRIM(name)) = ?
         AND TRIM(phone) = ?
         AND LOWER(TRIM(line1)) = ?
         AND TRIM(pincode) = ?
       LIMIT 1`
    )
      .bind(
        user.id,
        id,
        normalize(merged.name),
        (merged.phone || '').toString().trim(),
        normalize(merged.line1),
        (merged.pincode || '').toString().trim()
      )
      .first();

    if (duplicate) {
      return fail(c, 'This address already exists in your saved addresses.', 409);
    }

    if (merged.is_default === 1) {
      await c.env.DB.prepare(
        'UPDATE user_addresses SET is_default = 0 WHERE user_id = ?'
      )
        .bind(user.id)
        .run();
    }

    await c.env.DB.prepare(
      `UPDATE user_addresses SET name = ?, phone = ?, line1 = ?, line2 = ?, city = ?, state = ?, pincode = ?, is_default = ?, updated_at = datetime('now') WHERE id = ? AND user_id = ?`
    )
      .bind(
        merged.name,
        merged.phone,
        merged.line1,
        merged.line2,
        merged.city,
        merged.state,
        merged.pincode,
        merged.is_default,
        id,
        user.id
      )
      .run();

    const updated = await c.env.DB.prepare('SELECT * FROM user_addresses WHERE id = ?')
      .bind(id)
      .first();

    return ok(c, updated);
  } catch (err) {
    return fail(c, `Failed to update address: ${err.message}`, 500);
  }
});

/* --------------------------------------------------------------------- */
/* PUT/PATCH /api/users/addresses/:id/default - Address ko default banao  */
/* ✅ FIXED: WHERE clause me AND user_id = ? add kiya (security)         */
/* --------------------------------------------------------------------- */
const setDefaultAddressHandler = async (c) => {
  try {
    const user = c.get('user');
    const id = c.req.param('id');

    const existing = await c.env.DB.prepare(
      'SELECT * FROM user_addresses WHERE id = ? AND user_id = ?'
    )
      .bind(id, user.id)
      .first();

    if (!existing) return fail(c, 'Address not found.', 404);

    // Pehle sab defaults hatao
    await c.env.DB.prepare('UPDATE user_addresses SET is_default = 0 WHERE user_id = ?')
      .bind(user.id)
      .run();

    // ✅ FIX #3: AND user_id = ? add kiya
    await c.env.DB.prepare(
      `UPDATE user_addresses SET is_default = 1, updated_at = datetime('now') WHERE id = ? AND user_id = ?`
    )
      .bind(id, user.id)
      .run();

    const updated = await c.env.DB.prepare('SELECT * FROM user_addresses WHERE id = ?')
      .bind(id)
      .first();

    return ok(c, updated);
  } catch (err) {
    return fail(c, `Failed to set default address: ${err.message}`, 500);
  }
};

addresses.put('/:id/default', authMiddleware, setDefaultAddressHandler);
addresses.patch('/:id/default', authMiddleware, setDefaultAddressHandler);

/* --------------------------------------------------------------------- */
/* DELETE /api/users/addresses/:id - Address delete karo                  */
/* ✅ FIXED: Agar default address delete ho, toh next wala default banao */
/* --------------------------------------------------------------------- */
addresses.delete('/:id', authMiddleware, async (c) => {
  try {
    const user = c.get('user');
    const id = c.req.param('id');

    // Delete se pehle check karo default tha ya nahi
    const existing = await c.env.DB.prepare(
      'SELECT * FROM user_addresses WHERE id = ? AND user_id = ?'
    )
      .bind(id, user.id)
      .first();

    if (!existing) return fail(c, 'Address not found.', 404);

    const wasDefault = existing.is_default === 1;

    const result = await c.env.DB.prepare(
      'DELETE FROM user_addresses WHERE id = ? AND user_id = ?'
    )
      .bind(id, user.id)
      .run();

    if (result.meta?.changes === 0) return fail(c, 'Address not found.', 404);

    // ✅ Agar default delete hua toh next latest address ko default banao
    if (wasDefault) {
      const next = await c.env.DB.prepare(
        `SELECT id FROM user_addresses WHERE user_id = ? ORDER BY created_at DESC LIMIT 1`
      )
        .bind(user.id)
        .first();

      if (next) {
        await c.env.DB.prepare(
          `UPDATE user_addresses SET is_default = 1, updated_at = datetime('now') WHERE id = ? AND user_id = ?`
        )
          .bind(next.id, user.id)
          .run();
      }
    }

    return ok(c, { id, deleted: true });
  } catch (err) {
    return fail(c, `Failed to delete address: ${err.message}`, 500);
  }
});

export default addresses;
