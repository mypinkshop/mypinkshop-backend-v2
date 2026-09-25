// src/routes/sitemap.js
import { Hono } from 'hono';

const sitemap = new Hono();

sitemap.get('/sitemap.xml', async (c) => {
  try {
    const baseUrl = 'https://www.mypinkshop.com';
    const today = new Date().toISOString().split('T')[0];

    // ✅ Categories fetch karo
    const { results: categories } = await c.env.DB.prepare(
      `SELECT slug, updated_at FROM categories WHERE status = 'active' ORDER BY "order" ASC`
    ).all();

    // ✅ Products fetch karo
    const { results: products } = await c.env.DB.prepare(
      `SELECT id, updated_at FROM products WHERE is_active = 1 ORDER BY created_at DESC LIMIT 1000`
    ).all();

    let xml = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">

  <!-- Homepage -->
  <url>
    <loc>${baseUrl}/</loc>
    <lastmod>${today}</lastmod>
    <changefreq>daily</changefreq>
    <priority>1.0</priority>
  </url>

  <!-- Shop -->
  <url>
    <loc>${baseUrl}/shop</loc>
    <lastmod>${today}</lastmod>
    <changefreq>daily</changefreq>
    <priority>0.9</priority>
  </url>

  <!-- Static Pages -->
  <url><loc>${baseUrl}/contact</loc><priority>0.5</priority></url>
  <url><loc>${baseUrl}/faqs</loc><priority>0.5</priority></url>
  <url><loc>${baseUrl}/shipping-info</loc><priority>0.4</priority></url>
  <url><loc>${baseUrl}/returns-policy</loc><priority>0.4</priority></url>
  <url><loc>${baseUrl}/privacy</loc><priority>0.3</priority></url>
  <url><loc>${baseUrl}/terms</loc><priority>0.3</priority></url>
`;

    // ✅ Categories
    if (categories && categories.length > 0) {
      xml += `\n  <!-- Categories -->\n`;
      categories.forEach(cat => {
        const lastmod = cat.updated_at ? cat.updated_at.split(' ')[0] : today;
        xml += `  <url>
    <loc>${baseUrl}/category/${cat.slug}</loc>
    <lastmod>${lastmod}</lastmod>
    <changefreq>weekly</changefreq>
    <priority>0.8</priority>
  </url>\n`;
      });
    }

    // ✅ Products
    if (products && products.length > 0) {
      xml += `\n  <!-- Products -->\n`;
      products.forEach(prod => {
        const lastmod = prod.updated_at ? prod.updated_at.split(' ')[0] : today;
        xml += `  <url>
    <loc>${baseUrl}/product/${prod.id}</loc>
    <lastmod>${lastmod}</lastmod>
    <changefreq>weekly</changefreq>
    <priority>0.7</priority>
  </url>\n`;
      });
    }

    xml += `\n</urlset>`;

    c.header('Content-Type', 'application/xml; charset=utf-8');
    c.header('Cache-Control', 'public, max-age=3600');
    return c.body(xml);

  } catch (err) {
    console.error('Sitemap error:', err);
    return c.text(`Error: ${err.message}`, 500);
  }
});

export default sitemap;
