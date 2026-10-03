// src/lib/imageUpload.js

const R2_PUBLIC_URL = 'https://pub-845f68571d2b4c4b9ea02fb8f6162582.r2.dev';

/**
 * Amazon image URL → download → R2 upload → return public URL
 */
export async function uploadImageToR2(env, amazonUrl, productId, index = 0) {
  if (!amazonUrl || !env.IMAGES_BUCKET) return amazonUrl;

  try {
    const res = await fetch(amazonUrl, {
      headers: {
        'User-Agent':
          'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
        'Accept': 'image/avif,image/webp,image/apng,image/*,*/*;q=0.8',
        'Referer': 'https://www.amazon.in/',
      },
    });

    if (!res.ok) {
      console.warn(`[R2] Download failed ${amazonUrl}: ${res.status}`);
      return amazonUrl;
    }

    const buffer = await res.arrayBuffer();
    const contentType = res.headers.get('content-type') || 'image/jpeg';
    const ext = contentType.includes('png')
      ? 'png'
      : contentType.includes('webp')
      ? 'webp'
      : 'jpg';

    const safeProductId = String(productId || 'unknown').replace(/[^a-z0-9_-]/gi, '');
    const filename = `products/${safeProductId}/${Date.now()}-${index}.${ext}`;

    await env.IMAGES_BUCKET.put(filename, buffer, {
      httpMetadata: {
        contentType,
        cacheControl: 'public, max-age=31536000, immutable',
      },
    });

    return `${R2_PUBLIC_URL}/${filename}`;
  } catch (err) {
    console.error('[R2] uploadImageToR2 error:', err);
    return amazonUrl;
  }
}

export async function uploadImagesToR2(env, amazonUrls, productId) {
  if (!Array.isArray(amazonUrls) || amazonUrls.length === 0) return [];
  return Promise.all(
    amazonUrls.map((url, i) => uploadImageToR2(env, url, productId, i))
  );
}
