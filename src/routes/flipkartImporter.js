// src/routes/flipkartImporter.js
import { Hono } from 'hono';
import { authMiddleware, requireAdmin } from './auth.js';
import { ok, fail, genId } from '../lib/utils.js';

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
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
      }
    });

    if (!response.ok) {
      return fail(c, `Failed to fetch Flipkart page. Status: ${response.status}`, 400);
    }

    const html = await response.text();

    // ✅ Extract data using JSON-LD (structured data) - Ye sabse reliable hai
    let productData = {};
    
    // Method 1: JSON-LD se data nikaalo
    const jsonLdMatch = html.match(/<script type="application\/ld\+json">(.*?)<\/script>/);
    if (jsonLdMatch) {
      try {
        const jsonLd = JSON.parse(jsonLdMatch[1]);
        if (jsonLd.name && jsonLd.offers) {
          productData = {
            name: jsonLd.name,
            price: jsonLd.offers?.price || 0,
            image: jsonLd.image || '',
            description: jsonLd.description || ''
          };
        }
      } catch (e) {
        // JSON parse fail hua, koi baat nahi
      }
    }

    // Method 2: Agar JSON-LD nahi mila, toh text-based extraction karo
    if (!productData.name) {
      const titleMatch = html.match(/<h1[^>]*>(.*?)<\/h1>/);
      const priceMatch = html.match(/₹\s*([\d,]+(?:\.\d+)?)/);
      
      if (titleMatch) {
        productData.name = titleMatch[1].replace(/<[^>]+>/g, '').trim();
      }
      
      if (priceMatch) {
        productData.price = parseFloat(priceMatch[1].replace(/,/g, ''));
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
