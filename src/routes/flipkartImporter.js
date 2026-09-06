// src/routes/flipkartImporter.js
import { Hono } from 'hono';
import { authMiddleware, requireAdmin } from './auth.js';
import { ok, fail, genId } from '../lib/utils.js';

const importer = new Hono();

// ✅ GET /api/import/flipkart (Test route - sirf URL check karne ke liye)
importer.get('/flipkart', async (c) => {
  return ok(c, { message: 'Flipkart importer route is working!' });
});

// ✅ POST /api/import/flipkart (Actual Import)
importer.post('/flipkart', authMiddleware, requireAdmin, async (c) => {
  try {
    const { url } = await c.req.json();
    
    if (!url || !url.includes('flipkart.com')) {
      return fail(c, 'Please provide a valid Flipkart product URL.', 400);
    }

    const response = await fetch(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
      }
    });

    if (!response.ok) {
      return fail(c, `Failed to fetch Flipkart page. Status: ${response.status}`, 400);
    }

    const html = await response.text();

    // ✅ Extract data (Basic regex parsing - aap isko aur behtar bana sakte ho)
    const titleMatch = html.match(/<h1[^>]*class="[^"]*"[^>]*>(.*?)<\/h1>/);
    const priceMatch = html.match(/<div[^>]*class="[^"]*_30jeq3[^"]*"[^>]*>(.*?)<\/div>/);
    const imageMatch = html.match(/<img[^>]*src="(.*?)"[^>]*class="[^"]*_396cs4[^"]*"/);

    if (!titleMatch) {
      return fail(c, 'Unable to extract product data. Please check the URL.', 400);
    }

    const productName = titleMatch[1].replace(/<[^>]+>/g, '').trim();
    const price = priceMatch ? parseFloat(priceMatch[1].replace(/[^0-9.]/g, '')) : 0;
    const image = imageMatch ? imageMatch[1] : '';

    if (!productName || price === 0) {
      return fail(c, 'Invalid Flipkart product data. Please check the URL.', 400);
    }

    return ok(c, {
      scraped: {
        name: productName,
        price: price,
        originalPrice: price * 1.2,
        brand: '',
        description: [],
        keyFeatures: [],
        images: image ? [image] : [],
        weight: '',
        ingredients: ''
      }
    });
  } catch (err) {
    return fail(c, `Failed to import from Flipkart: ${err.message}`, 500);
  }
});

export default importer;
