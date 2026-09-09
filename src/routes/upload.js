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

    // ✅ Safe Base64 Conversion (Chunked to prevent Maximum call stack size exceeded error)
    const uint8Array = new Uint8Array(arrayBuffer);
    let binary = '';
    const chunkSize = 32768; // 32KB chunks to prevent stack overflow
    for (let i = 0; i < uint8Array.length; i += chunkSize) {
      const chunk = uint8Array.subarray(i, i + chunkSize);
      binary += String.fromCharCode.apply(null, chunk);
    }
    const base64 = btoa(binary);

    return ok(c, { url: `data:${file.type};base64,${base64}` });
  } catch (err) {
    return fail(c, `Failed to upload image: ${err.message}`, 500);
  }
});

export default upload;
