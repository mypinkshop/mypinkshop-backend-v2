// src/routes/amazonImporter.js
import { Hono } from 'hono';

const amazonImporter = new Hono();

// Amazon product URL scrape karne wala endpoint
amazonImporter.post('/amazon', async (c) => {
  try {
    const body = await c.req.json();
    const { url } = body;

    if (!url || !url.includes('amazon')) {
      return c.json(
        { success: false, error: 'Valid Amazon URL required' },
        400
      );
    }

    // Amazon page fetch karo
    const response = await fetch(url, {
      headers: {
        'User-Agent':
          'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'Accept-Language': 'en-IN,en;q=0.9',
        Accept:
          'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
      },
    });

    if (!response.ok) {
      return c.json(
        {
          success: false,
          error: `Amazon returned status ${response.status}. May be blocked.`,
        },
        400
      );
    }

    const html = await response.text();

    // Simple regex-based extraction (Workers mein cheerio nahi chalta easily)
    const extract = (regex) => {
      const match = html.match(regex);
      return match ? match[1].trim() : '';
    };

    // Product Name
    const name =
      extract(/<span[^>]*id="productTitle"[^>]*>([^<]+)<\/span>/i) ||
      extract(/<h1[^>]*id="title"[^>]*>([^<]+)<\/h1>/i);

    // Brand
    const brand = extract(
      /<a[^>]*id="bylineInfo"[^>]*>([^<]+)<\/a>/i
    )
      .replace(/Visit the|Store|Brand:/gi, '')
      .trim();

    // Price
    const priceRaw = extract(
      /<span[^>]*class="a-price-whole"[^>]*>([\d,]+)/i
    );
    const price = parseFloat(priceRaw.replace(/,/g, '')) || 0;

    // MRP
    const mrpRaw = extract(
      /<span[^>]*class="a-price a-text-price"[^>]*>.*?<span[^>]*class="a-offscreen"[^>]*>₹?([\d,]+)/is
    );
    const originalPrice = parseFloat(mrpRaw.replace(/,/g, '')) || price;

    // Images (main + thumbnails)
    const images = [];
    const imageRegex = /"hiRes":"(https:\/\/[^"]+\.jpg)"/g;
    let match;
    while ((match = imageRegex.exec(html)) !== null && images.length < 5) {
      const img = match[1];
      if (!images.includes(img)) images.push(img);
    }

    // Fallback: main image
    if (images.length === 0) {
      const mainImg = extract(
        /<img[^>]*id="landingImage"[^>]*src="([^"]+)"/i
      );
      if (mainImg) images.push(mainImg);
    }

    // Bullet points / description
    const description = [];
    const bulletRegex =
      /<span[^>]*class="a-list-item"[^>]*>([^<]{15,})<\/span>/g;
    while ((match = bulletRegex.exec(html)) !== null && description.length < 10) {
      const text = match[1].trim();
      if (
        text &&
        !text.toLowerCase().includes('see more') &&
        !description.includes(text)
      ) {
        description.push(text);
      }
    }

    if (!name) {
      return c.json(
        {
          success: false,
          error:
            'Could not scrape product. Amazon may have blocked or page layout changed.',
        },
        400
      );
    }

    return c.json({
      success: true,
      scraped: {
        name,
        brand,
        price,
        originalPrice,
        images,
        description,
        keyFeatures: description,
        rating: 4.5,
        weight: '',
        ingredients: '',
        skinType: 'all',
        concerns: [],
        variations: [],
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

export default amazonImporter;
