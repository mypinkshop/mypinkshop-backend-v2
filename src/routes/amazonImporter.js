// src/routes/amazonImporter.js
import { Hono } from 'hono';

const amazonImporter = new Hono();

// ============================================
// Helper: HTML Entities decode
// ============================================
const decodeHtml = (str) => {
  if (!str) return '';
  return str
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&nbsp;/g, ' ')
    .replace(/&#x27;/g, "'")
    .replace(/&#x2F;/g, '/')
    .replace(/\s+/g, ' ')
    .trim();
};

// ============================================
// Helper: Extract with regex
// ============================================
const extract = (html, regex) => {
  const match = html.match(regex);
  return match ? decodeHtml(match[1]) : '';
};

// ============================================
// Helper: Extract ASIN from various Amazon URLs
// ============================================
const extractASIN = (url) => {
  const patterns = [
    /\/dp\/([A-Z0-9]{10})/i,
    /\/gp\/product\/([A-Z0-9]{10})/i,
    /\/product\/([A-Z0-9]{10})/i,
    /[?&]asin=([A-Z0-9]{10})/i,
  ];
  for (const p of patterns) {
    const m = url.match(p);
    if (m) return m[1].toUpperCase();
  }
  return null;
};

// ============================================
// Helper: Parse product from HTML (multiple strategies)
// ============================================
const parseProductFromHtml = (html) => {
  // ---------- PRODUCT NAME ----------
  let name =
    extract(html, /<span[^>]*id=["']productTitle["'][^>]*>([^<]+)<\/span>/i) ||
    extract(html, /<h1[^>]*id=["']title["'][^>]*>[\s\S]*?<span[^>]*>([^<]+)<\/span>/i) ||
    extract(html, /<h1[^>]*class=["'][^"']*product-title[^"']*["'][^>]*>([^<]+)<\/h1>/i) ||
    extract(html, /"title"\s*:\s*"([^"]{10,})"/i) ||
    extract(html, /<meta[^>]*property=["']og:title["'][^>]*content=["']([^"']+)["']/i) ||
    extract(html, /<title>([^<|]+)/i);

  // Clean name
  name = name
    .replace(/Amazon\.in\s*:?/gi, '')
    .replace(/\s*:\s*Amazon\.[a-z]+/gi, '')
    .replace(/\s*[-|]\s*Amazon\.[a-z]+/gi, '')
    .trim();

  // ---------- BRAND ----------
  let brand =
    extract(html, /<a[^>]*id=["']bylineInfo["'][^>]*>([^<]+)<\/a>/i) ||
    extract(html, /"brand"\s*:\s*"([^"]+)"/i) ||
    extract(html, /<span[^>]*class=["'][^"']*a-size-base[^"']*["'][^>]*>\s*Brand:\s*<\/span>\s*<span[^>]*>([^<]+)<\/span>/i) ||
    extract(html, /<meta[^>]*name=["']description["'][^>]*content=["']([^"']+)/i);

  brand = brand
    .replace(/Visit the|Store|Brand:|^by\s+/gi, '')
    .replace(/\s+/g, ' ')
    .trim();

  // ---------- PRICE ----------
  let priceRaw =
    extract(html, /<span[^>]*class=["'][^"']*a-price-whole[^"']*["'][^>]*>([\d,]+)/i) ||
    extract(html, /"priceAmount"\s*:\s*([\d.]+)/i) ||
    extract(html, /<span[^>]*id=["']priceblock_ourprice["'][^>]*>[^\d]*([\d,]+)/i) ||
    extract(html, /<span[^>]*id=["']priceblock_dealprice["'][^>]*>[^\d]*([\d,]+)/i) ||
    extract(html, /class=["'][^"']*priceToPay[^"']*["'][^>]*>[\s\S]*?<span[^>]*class=["']a-offscreen["'][^>]*>[^\d]*([\d,]+)/i);

  const price = parseFloat(priceRaw.replace(/,/g, '')) || 0;

  // ---------- MRP ----------
  let mrpRaw =
    extract(html, /<span[^>]*class=["'][^"']*a-price a-text-price[^"']*["'][^>]*>[\s\S]*?<span[^>]*class=["']a-offscreen["'][^>]*>[^\d]*([\d,]+)/i) ||
    extract(html, /"strikePrice"\s*:\s*([\d.]+)/i) ||
    extract(html, /M\.R\.P\.?\s*:?\s*[^\d]*([\d,]+)/i);

  const originalPrice = parseFloat(mrpRaw.replace(/,/g, '')) || price;

  // ---------- IMAGES ----------
  const images = [];
  const imagePatterns = [
    /"hiRes"\s*:\s*"(https:\/\/[^"]+\.(?:jpg|jpeg|png))"/gi,
    /"large"\s*:\s*"(https:\/\/[^"]+\.(?:jpg|jpeg|png))"/gi,
    /data-old-hires=["'](https:\/\/[^"']+\.(?:jpg|jpeg|png))["']/gi,
    /<img[^>]*id=["']landingImage["'][^>]*src=["'](https:\/\/[^"']+)["']/gi,
    /<meta[^>]*property=["']og:image["'][^>]*content=["'](https:\/\/[^"']+)["']/i,
  ];

  for (const pattern of imagePatterns) {
    let m;
    while ((m = pattern.exec(html)) !== null && images.length < 5) {
      // Clean image URL (remove size suffix)
      let img = m[1]
        .replace(/\._[A-Z0-9_,]+_\./gi, '.')
        .replace(/_\.jpg$/i, '.jpg')
        .replace(/\._\.jpg$/i, '.jpg');

      // Convert to high-res if it's a thumbnail
      img = img.replace(/\.[A-Z0-9_]+\.jpg$/i, '.jpg');

      if (!images.includes(img)) {
        images.push(img);
      }
    }
    if (images.length >= 5) break;
  }

  // ---------- DESCRIPTION / BULLETS ----------
  const description = [];
  const seen = new Set();

  // Strategy 1: feature-bullets li
  const featureBulletRegex = /<div[^>]*id=["']feature-bullets["'][^>]*>[\s\S]*?<\/div>/i;
  const featureSection = html.match(featureBulletRegex);
  if (featureSection) {
    const liRegex = /<li[^>]*>[\s\S]*?<span[^>]*class=["'][^"']*a-list-item[^"']*["'][^>]*>([\s\S]*?)<\/span>/gi;
    let m;
    while ((m = liRegex.exec(featureSection[0])) !== null && description.length < 10) {
      const text = decodeHtml(m[1].replace(/<[^>]+>/g, ''));
      if (text.length > 15 && !seen.has(text) && !/see more|report|feedback/i.test(text)) {
        description.push(text);
        seen.add(text);
      }
    }
  }

  // Strategy 2: Fallback - any a-list-item span
  if (description.length === 0) {
    const liRegex = /<span[^>]*class=["'][^"']*a-list-item[^"']*["'][^>]*>([^<]{15,})<\/span>/gi;
    let m;
    while ((m = liRegex.exec(html)) !== null && description.length < 10) {
      const text = decodeHtml(m[1]);
      if (
        text &&
        !seen.has(text) &&
        !/see more|report|feedback|tell us|brief content/i.test(text)
      ) {
        description.push(text);
        seen.add(text);
      }
    }
  }

  // Strategy 3: Meta description fallback
  if (description.length === 0) {
    const metaDesc = extract(html, /<meta[^>]*name=["']description["'][^>]*content=["']([^"']+)/i);
    if (metaDesc && metaDesc.length > 20) {
      description.push(metaDesc);
    }
  }

  // ---------- RATING ----------
  const ratingRaw = extract(html, /([\d.]+)\s*out of 5 stars/i);
  const rating = parseFloat(ratingRaw) || 4.5;

  return {
    name,
    brand,
    price,
    originalPrice,
    images,
    description,
    keyFeatures: description,
    rating,
  };
};

// ============================================
// Main endpoint
// ============================================
amazonImporter.post('/amazon', async (c) => {
  try {
    const body = await c.req.json();
    const { url } = body;

    // ---------- VALIDATION ----------
    if (!url || typeof url !== 'string') {
      return c.json({ success: false, error: 'Amazon URL required' }, 400);
    }

    const trimmedUrl = url.trim();
    if (!/amazon\.(in|com|co\.uk|de|fr|ca)/i.test(trimmedUrl)) {
      return c.json({ success: false, error: 'Valid Amazon URL required' }, 400);
    }

    const asin = extractASIN(trimmedUrl);
    if (!asin) {
      return c.json(
        { success: false, error: 'Could not extract ASIN from URL. Please use a product page URL like /dp/XXXXXXXXXX' },
        400
      );
    }

    // ---------- CLEAN URL (use short form for best results) ----------
    const domain = trimmedUrl.match(/amazon\.(in|com|co\.uk|de|fr|ca)/i)[1];
    const cleanUrl = `https://www.amazon.${domain}/dp/${asin}`;

    // ---------- FETCH STRATEGY ----------
    let html = '';
    let fetchError = null;

    // STRATEGY 1: Direct fetch with rotating user agents
    const userAgents = [
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
      'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:123.0) Gecko/20100101 Firefox/123.0',
      'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Safari/605.1.15',
    ];

    const randomUA = userAgents[Math.floor(Math.random() * userAgents.length)];

    try {
      const directResponse = await fetch(cleanUrl, {
        headers: {
          'User-Agent': randomUA,
          'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8',
          'Accept-Language': 'en-IN,en-GB;q=0.9,en;q=0.8',
          'Accept-Encoding': 'gzip, deflate, br',
          'Cache-Control': 'no-cache',
          'Pragma': 'no-cache',
          'Sec-Fetch-Dest': 'document',
          'Sec-Fetch-Mode': 'navigate',
          'Sec-Fetch-Site': 'none',
          'Sec-Fetch-User': '?1',
          'Upgrade-Insecure-Requests': '1',
        },
        redirect: 'follow',
      });

      if (directResponse.ok) {
        const fetchedHtml = await directResponse.text();

        // Check if we got a real product page (not captcha/blocked)
        const isCaptcha = /captcha|robot check|api-services-support@amazon|enter the characters you see/i.test(fetchedHtml);
        const isRealProduct = fetchedHtml.includes('productTitle') || fetchedHtml.includes('landingImage') || fetchedHtml.includes('feature-bullets');

        if (isRealProduct && !isCaptcha && fetchedHtml.length > 10000) {
          html = fetchedHtml;
        } else if (isCaptcha) {
          fetchError = 'Amazon returned CAPTCHA — try ScraperAPI fallback';
        } else {
          fetchError = `Page too small or invalid (${fetchedHtml.length} bytes)`;
        }
      } else {
        fetchError = `Amazon returned ${directResponse.status}`;
      }
    } catch (err) {
      fetchError = `Fetch failed: ${err.message}`;
    }

    // STRATEGY 2: ScraperAPI fallback (agar env var set hai)
    if (!html && c.env.SCRAPER_API_KEY) {
      try {
        const scraperUrl = `https://api.scraperapi.com/?api_key=${c.env.SCRAPER_API_KEY}&url=${encodeURIComponent(cleanUrl)}&country_code=in&render=false`;

        const scraperResponse = await fetch(scraperUrl);

        if (scraperResponse.ok) {
          const scraperHtml = await scraperResponse.text();
          if (scraperHtml.length > 10000 && !/captcha|robot check/i.test(scraperHtml)) {
            html = scraperHtml;
            fetchError = null;
          }
        }
      } catch (err) {
        console.error('ScraperAPI fallback failed:', err);
      }
    }

    // ---------- HANDLE FETCH FAILURE ----------
    if (!html) {
      return c.json(
        {
          success: false,
          error: fetchError || 'Amazon blocked the request. Please add SCRAPER_API_KEY or try again later.',
          hint: 'Add SCRAPER_API_KEY to Cloudflare Workers env for reliable scraping.',
        },
        400
      );
    }

    // ---------- PARSE PRODUCT ----------
    const parsed = parseProductFromHtml(html);

    if (!parsed.name || parsed.name.length < 5) {
      return c.json(
        {
          success: false,
          error: 'Amazon page layout changed or product data missing. Try again.',
        },
        400
      );
    }

    // ---------- RESPONSE ----------
    return c.json({
      success: true,
      scraped: {
        name: parsed.name,
        brand: parsed.brand || '',
        price: parsed.price || 0,
        originalPrice: parsed.originalPrice || parsed.price || 0,
        images: parsed.images.length > 0 ? parsed.images : [],
        description: parsed.description,
        keyFeatures: parsed.keyFeatures,
        rating: parsed.rating,
        weight: '',
        ingredients: '',
        skinType: 'all',
        concerns: [],
        variations: [],
        asin,
        sourceUrl: cleanUrl,
      },
    });
  } catch (error) {
    console.error('Amazon import error:', error);
    return c.json(
      {
        success: false,
        error: error.message || 'Failed to fetch Amazon product',
      },
      500
    );
  }
});

// ============================================
// Debug endpoint (only for testing)
// ============================================
amazonImporter.get('/amazon/debug', async (c) => {
  const url = c.req.query('url');
  if (!url) return c.json({ error: 'Pass ?url=amazon_url' }, 400);

  try {
    const response = await fetch(url, {
      headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36' },
    });
    const html = await response.text();

    return c.json({
      status: response.status,
      htmlLength: html.length,
      isCaptcha: /captcha|robot check/i.test(html),
      hasProductTitle: html.includes('productTitle'),
      hasLandingImage: html.includes('landingImage'),
      hasFeatureBullets: html.includes('feature-bullets'),
      title: html.match(/<title[^>]*>([^<]*)<\/title>/i)?.[1] || 'none',
      preview: html.substring(0, 800),
    });
  } catch (error) {
    return c.json({ error: error.message }, 500);
  }
});

export default amazonImporter;
