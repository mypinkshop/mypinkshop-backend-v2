// src/routes/flipkartImporter.js
import { Hono } from 'hono';
import { authMiddleware, requireAdmin } from './auth.js';
import { ok, fail, genId } from '../lib/utils.js';

const importer = new Hono();

importer.post('/flipkart/import', authMiddleware, requireAdmin, async (c) => {
  try {
    const { url } = await c.req.json();
    
    // Fetch page from Flipkart
    const response = await fetch(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
      }
    });
    
    const html = await response.text();
    
    // Extract data (simple regex/parsing logic)
    const titleMatch = html.match(/<h1[^>]*>(.*?)<\/h1>/);
    const priceMatch = html.match(/<div class="_30jeq3[^>]*>(.*?)<\/div>/);
    const imageMatch = html.match(/<img[^>]*src="(.*?)"[^>]*class="_396cs4"/);
    
    if (!titleMatch || !priceMatch) {
      return fail(c, 'Unable to extract product data. Please check URL.');
    }
    
    const product = {
      id: genId('prod'),
      name: titleMatch[1],
      price: parseFloat(priceMatch[1].replace(/[^0-9.]/g, '')),
      images: imageMatch ? [imageMatch[1]] : [],
      is_active: 1,
      is_featured: 0,
      created_at: new Date().toISOString()
    };
    
    // Insert into D1 database
    await c.env.DB.prepare(
      `INSERT INTO products (id, name, price, images, is_active, is_featured, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`
    ).bind(
      product.id,
      product.name,
      product.price,
      JSON.stringify(product.images),
      product.is_active,
      product.is_featured,
      product.created_at
    ).run();
    
    return ok(c, { success: true, product });
  } catch (err) {
    return fail(c, `Failed to import from Flipkart: ${err.message}`, 500);
  }
});

export default importer;
