// src/routes/upload.js
import { Hono } from 'hono';
import { authMiddleware } from './auth.js';
import { ok, fail } from '../lib/utils.js';

const upload = new Hono();

// ✅ POST /api/upload - Image upload karne ke liye
upload.post('/', authMiddleware, async (c) => {
  try {
    const formData = await c.req.formData();
    const file = formData.get('images');
    
    if (!file) {
      return fail(c, 'No image file provided.', 400);
    }

    // ✅ Cloudflare R2 mein store karo (agar R2 binding configured hai)
    const arrayBuffer = await file.arrayBuffer();
    const key = `products/${Date.now()}-${file.name}`;
    
    // Agar R2 binding hai (env.MY_BUCKET), toh use karo
    if (c.env.MY_BUCKET) {
      await c.env.MY_BUCKET.put(key, arrayBuffer, {
        httpMetadata: { contentType: file.type }
      });
      const url = `https://pub-845f68571d2b4c4b9ea02fb8f6162582.r2.dev/${key}`;
      return ok(c, { url });
    }

    // ✅ Agar R2 binding nahi hai, toh D1 mein base64 store karo (temporary solution)
    const base64 = btoa(String.fromCharCode(...new Uint8Array(arrayBuffer)));
    return ok(c, { url: `data:${file.type};base64,${base64}` });
  } catch (err) {
    return fail(c, `Failed to upload image: ${err.message}`, 500);
  }
});

export default upload;
