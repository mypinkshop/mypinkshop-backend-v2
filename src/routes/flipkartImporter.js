// src/routes/flipkartImporter.js
import { Hono } from 'hono';
import { authMiddleware, requireAdmin } from './auth.js';
import { ok, fail } from '../lib/utils.js';

const importer = new Hono();

// Flipkart's <title> tag (used as a fallback when JSON-LD product data
// isn't found) typically looks like:
//   "Buy Ajmal Kuro EDP Eau De Parfum - 90 ml Online In India | Flipkart.com"
// This strips the marketing prefix/suffix so only the product name remains.
function cleanProductName(raw) {
  return String(raw || '')
    .replace(/\s*\|\s*Flipkart\.com\s*$/i, '')
    .replace(/^\s*Buy\s+/i, '')
    .replace(/\s*-?\s*Online\s+(in\s+India)?\s*$/i, '')
    .replace(/\s*at\s+Best\s+Price(s)?\s+in\s+India.*$/i, '')
    .trim();
}

// Flipkart serves images from several CDN subdomains and formats — the old
// regex only matched `rukminim...jpg`, missing rukminim2/3, .jpeg, .png,
// and .webp variants.
function extractImageFromHtml(html) {
  const matches = html.match(
    /https:\/\/(?:rukminim\d*\.flixcart\.com|[a-z0-9.-]*flixcart\.com)[^"'\s\\]+?\.(?:jpg|jpeg|png|webp)/gi
  );
  return matches && matches.length > 0 ? matches[0] : '';
}

function extractJsonLdImage(jsonLd) {
  if (!jsonLd?.image) return '';
  return Array.isArray(jsonLd.image) ? jsonLd.image[0] || '' : jsonLd.image;
}

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

    // ✅ Flipkart bot detection ko bypass karne ke liye "Short Timeout" use karo
    const timeoutMs = 5000;
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

    const response = await fetch(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'Accept-Language': 'en-IN,en;q=0.9',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8'
      },
      redirect: 'follow',
      signal: controller.signal
    });

    clearTimeout(timeoutId);

    // ✅ Agar response 529 hai (server busy), toh timeout ke baad retry karo
    if (response.status === 529 || response.status === 503) {
      // 2 second wait
      await new Promise(resolve => setTimeout(resolve, 2000));
      
      const retryController = new AbortController();
      const retryTimeoutId = setTimeout(() => retryController.abort(), timeoutMs);
      
      const retryResponse = await fetch(url, {
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
        },
        redirect: 'follow',
        signal: retryController.signal
      });

      clearTimeout(retryTimeoutId);

      if (!retryResponse.ok) {
        return fail(c, `Failed to fetch Flipkart page. Status: ${retryResponse.status}`, 400);
      }

      const html = await retryResponse.text();

      // ✅ Scraping logic
      let productData = {};
      const jsonLdMatches = html.match(/<script type="application\/ld\+json">(.*?)<\/script>/g);
      if (jsonLdMatches) {
        for (const match of jsonLdMatches) {
          try {
            const jsonLd = JSON.parse(match.replace(/<script type="application\/ld\+json">|<\/script>/g, ''));
            if (jsonLd.name && jsonLd.offers) {
              productData = {
                name: cleanProductName(jsonLd.name),
                price: jsonLd.offers?.price || 0,
                image: extractJsonLdImage(jsonLd),
                description: jsonLd.description || ''
              };
              break;
            }
          } catch (e) {
            // JSON parse fail
          }
        }
      }

      if (!productData.name) {
        const titleMatch = html.match(/<title>(.*?)<\/title>/);
        if (titleMatch) {
          productData.name = cleanProductName(titleMatch[1]);
        }
      }

      if (!productData.price) {
        const priceMatch1 = html.match(/₹\s*([\d,]+(?:\.\d+)?)/);
        if (priceMatch1) {
          productData.price = parseFloat(priceMatch1[1].replace(/,/g, ''));
        }
      }

      if (!productData.image) {
        productData.image = extractImageFromHtml(html);
      }

      if (!productData.name || !productData.price) {
        // ⚠️ TEMPORARY DEBUG INFO — remove once we've diagnosed why
        // extraction is failing (likely Flipkart blocking/serving a
        // different page to Cloudflare Workers' outbound IPs).
        return fail(c, 'Unable to extract product data. Please check the URL or try a different product.', 400, {
          debugHttpStatus: retryResponse.status,
          debugHtmlLength: html.length,
          debugHasJsonLd: !!jsonLdMatches,
          debugHtmlSnippet: html.slice(0, 1500),
        });
      }

      // ✅ FIX: flat top-level shape (not wrapped via ok()) — the frontend
      // (AdminAddProduct.jsx's FlipkartImporter) reads data.scraped.name
      // directly off the response, not data.data.scraped.name.
      return c.json({
        success: true,
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
    }

    const html = await response.text();

    let productData = {};
    const jsonLdMatches = html.match(/<script type="application\/ld\+json">(.*?)<\/script>/g);
    if (jsonLdMatches) {
      for (const match of jsonLdMatches) {
        try {
          const jsonLd = JSON.parse(match.replace(/<script type="application\/ld\+json">|<\/script>/g, ''));
          if (jsonLd.name && jsonLd.offers) {
            productData = {
              name: cleanProductName(jsonLd.name),
              price: jsonLd.offers?.price || 0,
              image: extractJsonLdImage(jsonLd),
              description: jsonLd.description || ''
            };
            break;
          }
        } catch (e) {
          // JSON parse fail
        }
      }
    }

    if (!productData.name) {
      const titleMatch = html.match(/<title>(.*?)<\/title>/);
      if (titleMatch) {
        productData.name = cleanProductName(titleMatch[1]);
      }
    }

    if (!productData.price) {
      const priceMatch1 = html.match(/₹\s*([\d,]+(?:\.\d+)?)/);
      if (priceMatch1) {
        productData.price = parseFloat(priceMatch1[1].replace(/,/g, ''));
      }
    }

    if (!productData.image) {
      productData.image = extractImageFromHtml(html);
    }

    if (!productData.name || !productData.price) {
      // ⚠️ TEMPORARY DEBUG INFO — remove once we've diagnosed why
      // extraction is failing (likely Flipkart blocking/serving a
      // different page to Cloudflare Workers' outbound IPs).
      return fail(c, 'Unable to extract product data. Please check the URL or try a different product.', 400, {
        debugHttpStatus: response.status,
        debugHtmlLength: html.length,
        debugHasJsonLd: !!jsonLdMatches,
        debugHtmlSnippet: html.slice(0, 1500),
      });
    }

    // ✅ FIX: same flat shape as above.
    return c.json({
      success: true,
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
