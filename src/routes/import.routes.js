// backend/src/routes/import.routes.js
import express from 'express';
import axios from 'axios';
import * as cheerio from 'cheerio';
import { verifyAdmin } from '../middleware/auth.js'; // tumhara auth middleware

const router = express.Router();

// ============================================
// AMAZON SCRAPER
// ============================================
router.post('/amazon', verifyAdmin, async (req, res) => {
  try {
    const { url } = req.body;

    if (!url || !url.includes('amazon')) {
      return res.status(400).json({ 
        success: false, 
        error: 'Valid Amazon URL required' 
      });
    }

    // Amazon se page fetch karo
    const { data: html } = await axios.get(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'Accept-Language': 'en-IN,en;q=0.9',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8'
      },
      timeout: 15000
    });

    const $ = cheerio.load(html);

    // Product name
    const name = $('#productTitle').text().trim() || 
                 $('h1#title').text().trim() || 
                 $('h1.product-title-word-break').text().trim();

    // Brand
    const brand = $('#bylineInfo').text().replace('Brand:', '').replace('Visit the', '').replace('Store', '').trim() || '';

    // Price
    const priceText = $('.a-price-whole').first().text().replace(/[^\d]/g, '') || 
                      $('#priceblock_ourprice').text().replace(/[^\d]/g, '') ||
                      $('.priceToPay .a-offscreen').text().replace(/[^\d]/g, '');
    const price = parseFloat(priceText) || 0;

    // Original price (MRP)
    const mrpText = $('.a-text-price .a-offscreen').first().text().replace(/[^\d]/g, '');
    const originalPrice = parseFloat(mrpText) || price;

    // Images
    const images = [];
    $('#altImages img').each((i, el) => {
      let src = $(el).attr('src');
      if (src && !src.includes('sprite') && !src.includes('play-icon')) {
        src = src.replace(/_.*_\.jpg$/, '.jpg').replace(/\._[A-Z0-9_,]+\./, '.');
        if (src.startsWith('https') && !images.includes(src)) {
          images.push(src);
        }
      }
    });
    if (images.length === 0) {
      const mainImg = $('#landingImage').attr('src');
      if (mainImg) images.push(mainImg);
    }

    // Description / Bullet points
    const description = [];
    $('#feature-bullets li span.a-list-item').each((i, el) => {
      const text = $(el).text().trim();
      if (text && text.length > 15 && description.length < 10) {
        description.push(text);
      }
    });

    // Key Features (same as description for Amazon)
    const keyFeatures = [...description];

    // Customer Reviews / Rating
    const ratingText = $('span[data-hook="rating-out-of-text"]').text() || 
                       $('.a-icon-alt').first().text();
    const rating = parseFloat(ratingText) || 4.5;

    // If no data scraped, return error
    if (!name) {
      return res.status(400).json({
        success: false,
        error: 'Could not scrape product. Amazon may have blocked or page layout changed.'
      });
    }

    res.json({
      success: true,
      scraped: {
        name,
        brand,
        price,
        originalPrice,
        images: images.slice(0, 5),
        description,
        keyFeatures,
        rating,
        weight: '',
        ingredients: '',
        skinType: 'all',
        concerns: [],
        variations: []
      }
    });

  } catch (error) {
    console.error('Amazon import error:', error.message);
    res.status(500).json({
      success: false,
      error: error.message || 'Failed to fetch Amazon product'
    });
  }
});

// ============================================
// FLIPKART SCRAPER
// ============================================
router.post('/flipkart', verifyAdmin, async (req, res) => {
  try {
    const { url } = req.body;

    if (!url || !url.includes('flipkart')) {
      return res.status(400).json({ 
        success: false, 
        error: 'Valid Flipkart URL required' 
      });
    }

    const { data: html } = await axios.get(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'Accept-Language': 'en-IN,en;q=0.9'
      },
      timeout: 15000
    });

    const $ = cheerio.load(html);

    const name = $('span.B_NuCI').text().trim() || 
                 $('h1._6EbuvT span').text().trim() ||
                 $('h1').first().text().trim();

    const brand = $('span.G6XhRU').text().trim() || 
                  $('._2WkVRV').first().text().trim() || '';

    const priceText = $('div._30jeq3._16Jk6d').text().replace(/[^\d]/g, '') ||
                      $('div._30jeq3').text().replace(/[^\d]/g, '');
    const price = parseFloat(priceText) || 0;

    const mrpText = $('div._3I9_wc._2p6lqe').text().replace(/[^\d]/g, '') ||
                    $('div._3I9_wc').text().replace(/[^\d]/g, '');
    const originalPrice = parseFloat(mrpText) || price;

    const images = [];
    $('img._2r_T1I, img.q6DClP, img._396cs4').each((i, el) => {
      const src = $(el).attr('src');
      if (src && src.startsWith('http') && !images.includes(src) && images.length < 5) {
        images.push(src);
      }
    });

    const description = [];
    $('div._2418kt li, ul._1xgFaf li').each((i, el) => {
      const text = $(el).text().trim();
      if (text && text.length > 15 && description.length < 10) {
        description.push(text);
      }
    });

    const keyFeatures = [...description];

    if (!name) {
      return res.status(400).json({
        success: false,
        error: 'Could not scrape product. Flipkart may have blocked or page layout changed.'
      });
    }

    res.json({
      success: true,
      scraped: {
        name,
        brand,
        price,
        originalPrice,
        images,
        description,
        keyFeatures,
        rating: 4.5,
        weight: '',
        ingredients: '',
        skinType: 'all',
        concerns: [],
        variations: []
      }
    });

  } catch (error) {
    console.error('Flipkart import error:', error.message);
    res.status(500).json({
      success: false,
      error: error.message || 'Failed to fetch Flipkart product'
    });
  }
});

export default router;
