// src/routes/feed.js
import { Hono } from 'hono';

const feed = new Hono();

/* XML escape helper */
function escapeXml(str) {
  if (!str) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

/* GET /api/feed/google.xml */
feed.get('/google.xml', async (c) => {
  try {
    // ✅ Sirf active products
    const { results: products } = await c.env.DB.prepare(
      `SELECT 
        id, name, description, short_description, 
        price, original_price, stock, 
        images, brand, sku, main_category
       FROM products 
       WHERE is_active = 1 
         AND price > 0 
         AND name IS NOT NULL
       LIMIT 5000`
    ).all();

    const baseUrl = 'https://www.mypinkshop.com';

    let xml = `<?xml version="1.0" encoding="UTF-8"?>\n`;
    xml += `<rss xmlns:g="http://base.google.com/ns/1.0" version="2.0">\n`;
    xml += `  <channel>\n`;
    xml += `    <title>MyPinkShop</title>\n`;
    xml += `    <link>${baseUrl}</link>\n`;
    xml += `    <description>MyPinkShop Product Feed</description>\n`;

    for (const p of products || []) {
      const pid = p.id;
      const productUrl = `${baseUrl}/product/${pid}`;

      // ✅ Image — pehli image, absolute URL
      let images = p.images;
      if (typeof images === 'string') {
        try { images = JSON.parse(images || '[]'); } catch { images = []; }
      }
      const firstImage = Array.isArray(images) && images[0]
        ? (images[0].startsWith('http') ? images[0] : `${baseUrl}${images[0]}`)
        : '';

      // ✅ Description — short ya full
      let desc = p.short_description || p.description || p.name;
      if (Array.isArray(desc)) desc = desc.join(' ');
      if (typeof desc === 'string') desc = desc.trim();
      if (desc.length > 5000) desc = desc.substring(0, 5000);

      // ✅ Price — 499.00 INR format
      const price = Number(p.price || 0).toFixed(2);
      const availability = Number(p.stock) > 0 ? 'in_stock' : 'out_of_stock';

      xml += `    <item>\n`;
      xml += `      <g:id>${escapeXml(pid)}</g:id>\n`;
      xml += `      <g:title>${escapeXml(String(p.name).substring(0, 150))}</g:title>\n`;
      xml += `      <g:description>${escapeXml(desc)}</g:description>\n`;
      xml += `      <g:link>${escapeXml(productUrl)}</g:link>\n`;
      if (firstImage) {
        xml += `      <g:image_link>${escapeXml(firstImage)}</g:image_link>\n`;
      }
      xml += `      <g:availability>${availability}</g:availability>\n`;
      xml += `      <g:price>${price} INR</g:price>\n`;
      xml += `      <g:condition>new</g:condition>\n`;
      if (p.brand) {
        xml += `      <g:brand>${escapeXml(p.brand)}</g:brand>\n`;
      }
      if (p.sku) {
        xml += `      <g:mpn>${escapeXml(p.sku)}</g:mpn>\n`;
      }
      if (p.main_category) {
        xml += `      <g:product_type>${escapeXml(p.main_category)}</g:product_type>\n`;
      }
      xml += `    </item>\n`;
    }

    xml += `  </channel>\n`;
    xml += `</rss>\n`;

    return c.body(xml, 200, {
      'Content-Type': 'application/xml; charset=utf-8',
      'Cache-Control': 'public, max-age=3600',
    });
  } catch (err) {
    console.error('Feed error:', err);
    return c.body('Feed generation failed', 500);
  }
});

export default feed;
