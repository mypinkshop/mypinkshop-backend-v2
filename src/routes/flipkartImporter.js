// src/routes/flipkartImporter.js
import { Hono } from 'hono';
import { authMiddleware, requireAdmin } from './auth.js';
import { ok, fail } from '../lib/utils.js';

const importer = new Hono();

// ✅ GET /api/import/flipkart (Test route)
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
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'Accept-Language': 'en-IN,en;q=0.9',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8'
      },
      redirect: 'follow'
    });

    if (!response.ok) {
      return fail(c, `Failed to fetch Flipkart page. Status: ${response.status}`, 400);
    }

    const html = await response.text();

    // ✅ Method 1: JSON-LD se data nikaalo (Most Reliable)
    let productData = {};
    const jsonLdMatches = html.match(/<script type="application\/ld\+json">(.*?)<\/script>/g);
    if (jsonLdMatches) {
      for (const match of jsonLdMatches) {
        try {
          const jsonLd = JSON.parse(match.replace(/<script type="application\/ld\+json">|<\/script>/g, ''));
          if (jsonLd.name && jsonLd.offers) {
            productData = {
              name: jsonLd.name,
              price: jsonLd.offers?.price || 0,
              image: jsonLd.image || '',
              description: jsonLd.description || ''
            };
            break;
          }
        } catch (e) {
          // JSON parse fail, continue
        }
      }
    }

    // ✅ Method 2: Page title se naam nikaalo
    if (!productData.name) {
      const titleMatch = html.match(/<title>(.*?)<\/title>/);
      if (titleMatch) {
        productData.name = titleMatch[1].replace(/\s*\| Flipkart\.com$/, '').trim();
      }
    }

    // ✅ Method 3: Price nikaalo (Multiple patterns)
    if (!productData.price) {
      // Pattern 1: price wale div se
      const priceMatch1 = html.match(/₹\s*([\d,]+(?:\.\d+)?)/);
      if (priceMatch1) {
        productData.price = parseFloat(priceMatch1[1].replace(/,/g, ''));
      }
      
      // Pattern 2: JSON mein price dhundho
      if (!productData.price) {
        const priceJson = html.match(/"price"\s*:\s*"?([\d.]+)"?/);
        if (priceJson) {
          productData.price = parseFloat(priceJson[1]);
        }
      }
    }

    // ✅ Method 4: Images nikaalo
    if (!productData.image) {
      const imageMatches = html.match(/https:\/\/rukminim[^"']+\.jpg/g);
      if (imageMatches && imageMatches.length > 0) {
        productData.image = imageMatches[0];
      }
    }

    if (!productData.name || !productData.price) {
      return fail(c, 'Unable to extract product data. Please check the URL or try a different product.', 400);
    }

    return ok(c, {
      scraped: {
        name: productData.name,
        price: productData.price,
        originalPrice: productData.price * 1.2,
        brand: '',
        description: productData.description ? [productData.description] : [],
        keyFeatures: [],
        images: productData.image ? [productData.image] : [],
        weight: '',
        ingredients: ''
      }
    });
  } catch (err) {
    return fail(c, `Failed to import from Flipkart: ${err.message}`, 500);
  }
});

export default importer;
