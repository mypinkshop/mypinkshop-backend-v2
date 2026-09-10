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

// Flipkart serves images from several CDN subdomains and formats — collects
// ALL product gallery images (not just one), deduped, filtering out obvious
// non-product assets (site logos/icons/sprites).
function extractImagesFromHtml(html, max = 8) {
  const matches = html.match(
    /https:\/\/(?:rukminim\d*\.flixcart\.com|[a-z0-9.-]*flixcart\.com)[^"'\s\\]+?\.(?:jpg|jpeg|png|webp)/gi
  ) || [];

  const seen = new Set();
  const images = [];
  for (const url of matches) {
    const lower = url.toLowerCase();
    if (lower.includes('logo') || lower.includes('sprite') || lower.includes('icon')) continue;
    if (seen.has(url)) continue;
    seen.add(url);
    images.push(url);
    if (images.length >= max) break;
  }
  return images;
}

// jsonLd.image may be a single string or an array of strings.
function extractJsonLdImages(jsonLd) {
  if (!jsonLd?.image) return [];
  return Array.isArray(jsonLd.image) ? jsonLd.image.filter(Boolean) : [jsonLd.image];
}

// jsonLd.brand may be a string, or an object like { "@type": "Brand", "name": "..." }.
function extractJsonLdBrand(jsonLd) {
  if (!jsonLd?.brand) return '';
  if (typeof jsonLd.brand === 'string') return jsonLd.brand;
  return jsonLd.brand.name || '';
}

// Best-effort weight/volume extraction (e.g. "90 ml", "250 g", "1 kg") from
// the product name, since Flipkart doesn't expose this in a consistent
// structured field we can reliably scrape.
function extractWeight(name) {
  const match = String(name || '').match(/(\d+(?:\.\d+)?)\s?(ml|l|litre|liter|kg|gm|gms|g)\b/i);
  if (!match) return '';
  return `${match[1]} ${match[2].toLowerCase()}`;
}

// ✅ GET /api/import/flipkart (Test route)
importer.get('/flipkart', async (c) => {
  return ok(c, { message: 'Flipkart importer route is working!' });
});

function parseFlipkartHtml(html) {
  let productData = { images: [], brand: '' };

  const jsonLdMatches = html.match(/<script type="application\/ld\+json">(.*?)<\/script>/g);
  if (jsonLdMatches) {
    for (const match of jsonLdMatches) {
      try {
        const jsonLd = JSON.parse(match.replace(/<script type="application\/ld\+json">|<\/script>/g, ''));
        if (jsonLd.name && jsonLd.offers) {
          productData = {
            name: cleanProductName(jsonLd.name),
            price: jsonLd.offers?.price || 0,
            images: extractJsonLdImages(jsonLd),
            brand: extractJsonLdBrand(jsonLd),
            description: jsonLd.description || ''
          };
          break;
        }
      } catch (e) {
        // JSON parse fail, try next script block
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

  if (!productData.images || productData.images.length === 0) {
    productData.images = extractImagesFromHtml(html);
  }

  if (!productData.weight) {
    productData.weight = extractWeight(productData.name);
  }

  return { productData, jsonLdMatches };
}

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

    let response = await fetch(url, {
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
      await new Promise(resolve => setTimeout(resolve, 2000));

      const retryController = new AbortController();
      const retryTimeoutId = setTimeout(() => retryController.abort(), timeoutMs);

      response = await fetch(url, {
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
        },
        redirect: 'follow',
        signal: retryController.signal
      });

      clearTimeout(retryTimeoutId);
    }

    if (!response.ok) {
      return fail(c, `Failed to fetch Flipkart page. Status: ${response.status}`, 400);
    }

    const html = await response.text();
    const { productData, jsonLdMatches } = parseFlipkartHtml(html);

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

    // ✅ FIX: flat top-level shape (not wrapped via ok()) — the frontend
    // (AdminAddProduct.jsx's FlipkartImporter) reads data.scraped.name
    // directly off the response, not data.data.scraped.name.
    return c.json({
      success: true,
      scraped: {
        name: productData.name,
        price: productData.price,
        originalPrice: productData.price * 1.2,
        brand: productData.brand || '',
        description: productData.description ? [productData.description] : [],
        keyFeatures: [],
        images: productData.images || [],
        weight: productData.weight || '',
        ingredients: ''
      }
    });
  } catch (err) {
    return fail(c, `Failed to import from Flipkart: ${err.message}`, 500);
  }
});

export default importer;
