import { execFile } from 'child_process';
import util from 'util';
import fs from 'fs';

const execFilePromise = util.promisify(execFile);

const BROWSER_UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36';

function getCurlBinary() {
    if (process.platform === 'win32') {
        const sys32 = 'C:\\Windows\\System32\\curl.exe';
        if (fs.existsSync(sys32)) {
            return sys32;
        }
        return 'curl.exe';
    }
    return 'curl';
}

/**
 * Normalizes user input into a valid Meshy AI URL.
 * Supports:
 * - Full 3D model URLs: https://www.meshy.ai/3d-models/Bullet-Rain-01a1e9b4-e914-77de-9458-b6625dea4cd6...
 * - Shortened share URLs: https://www.meshy.ai/s/39mTE9
 * - Direct CDN model URLs: https://api.meshy.ai/misc/cdn-models/...
 * - Short codes: 39mTE9
 */
export function normalizeMeshyUrl(input) {
    if (!input || typeof input !== 'string') {
        throw new Error('Please enter a valid Meshy AI URL.');
    }

    let trimmed = input.trim();

    // Direct CDN model link
    if (trimmed.startsWith('https://api.meshy.ai/misc/cdn-models/')) {
        return trimmed;
    }

    // Bare code like 39mTE9
    if (!trimmed.includes('/') && !trimmed.includes('.')) {
        return `https://www.meshy.ai/s/${trimmed}`;
    }

    // Ensure protocol
    if (!trimmed.startsWith('http://') && !trimmed.startsWith('https://')) {
        trimmed = `https://${trimmed}`;
    }

    return trimmed;
}

/**
 * Fetches Meshy data using Next.js React Server Component (RSC) router requests first.
 * Cloudflare Turnstile bot challenges target HTML documents, whereas RSC payloads
 * bypass the bot gate on datacenter IPs (like Render) while delivering the signed model URL.
 */
async function fetchPageContent(targetUrl) {
    const curlBinary = getCurlBinary();

    // 1. Try Next.js RSC fetch first (primary anti-Cloudflare bypass for datacenter IPs)
    try {
      const rscResp = await fetch(targetUrl, {
        redirect: 'follow',
        headers: {
          'RSC': '1',
          'Accept': 'text/x-component, */*',
          'User-Agent': BROWSER_UA
        }
      });

      if (rscResp.ok) {
        const text = await rscResp.text();
        if (text.includes('.meshy?sign=')) {
          return text;
        }
      }
    } catch {
      // Continue to next method
    }

    // 2. Try curl with RSC header
    try {
      const { stdout } = await execFilePromise(curlBinary, [
        '-s',
        '-L',
        targetUrl,
        '-H', 'RSC: 1',
        '-H', 'Accept: text/x-component, */*',
        '-A', BROWSER_UA
      ], {
        timeout: 15000,
        maxBuffer: 15 * 1024 * 1024
      });

      if (stdout && stdout.includes('.meshy?sign=')) {
        return stdout;
      }
    } catch {
      // Continue to next method
    }

    // 3. Fallback: Standard curl HTML request
    try {
      const { stdout } = await execFilePromise(curlBinary, [
        '-s',
        '-L',
        targetUrl,
        '-A', BROWSER_UA,
        '-H', 'Accept: text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8',
        '-H', 'Accept-Language: en-US,en;q=0.9'
      ], {
        timeout: 15000,
        maxBuffer: 15 * 1024 * 1024
      });

      if (stdout && stdout.length > 500 && !stdout.includes('Just a moment...')) {
        return stdout;
      }
    } catch {
      // Continue to next method
    }

    // 4. Fallback: Standard native fetch
    const resp = await fetch(targetUrl, {
      redirect: 'follow',
      headers: {
        'User-Agent': BROWSER_UA,
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8',
        'Accept-Language': 'en-US,en;q=0.9'
      }
    });

    return await resp.text();
}

/**
 * Extracts metadata and signed encrypted model CDN URL from a Meshy share link.
 *
 * @param {string} inputUrl 
 * @returns {Promise<{
 *   shareUrl: string,
 *   modelUrl: string,
 *   previewUrl: string|null,
 *   title: string,
 *   taskId: string|null
 * }>}
 */
export async function extractMeshyMetadata(inputUrl) {
    const shareUrl = normalizeMeshyUrl(inputUrl);

    // If directly provided the CDN .meshy URL
    if (shareUrl.includes('api.meshy.ai/misc/cdn-models/')) {
        const taskMatch = shareUrl.match(/\/tasks\/([a-zA-Z0-9\-]+)\//);
        const taskId = taskMatch ? taskMatch[1] : null;
        return {
            shareUrl,
            modelUrl: shareUrl,
            previewUrl: null,
            title: taskId ? `Model ${taskId.slice(0, 8)}` : 'Decrypted 3D Model',
            taskId
        };
    }

    const html = await fetchPageContent(shareUrl);

    // 1. Extract signed model.meshy URL
    const modelMatch = html.match(/https:\/\/api\.meshy\.ai\/misc\/cdn-models\/[^\s"'<>]+\.meshy\?sign=[a-zA-Z0-9_\-]+/);
    if (!modelMatch) {
        if (html.includes('Just a moment...') || html.includes('cf-browser-verification')) {
            throw new Error('Meshy page was challenged by Cloudflare. Please try again or paste the direct model link.');
        }
        throw new Error('Could not find encrypted 3D model payload in the provided Meshy link.');
    }
    const modelUrl = modelMatch[0];

    // 2. Extract Task ID
    const taskMatch = modelUrl.match(/\/tasks\/([a-zA-Z0-9\-]+)\//);
    const taskId = taskMatch ? taskMatch[1] : null;

    // 3. Extract Preview Image
    let previewUrl = null;
    const previewMatch = html.match(/https:\/\/api\.meshy\.ai\/misc\/cdn-images\/[^\s"'<>]+\/output\/preview(?:_watermark)?\.png\?sign=[a-zA-Z0-9_\-]+/);
    if (previewMatch) {
        previewUrl = previewMatch[0];
    } else {
        const ogImageMatch = html.match(/<meta\s+property=["']og:image["']\s+content=["']([^"']+)["']/i) 
          || html.match(/\{"property":"og:image","content":"([^"]+)"\}/);
        if (ogImageMatch && ogImageMatch[1]) {
            previewUrl = ogImageMatch[1];
        }
    }

    // 4. Extract Model Title
    let title = null;

    // Try RSC metadata children
    const rscTitleMatch = html.match(/\{"children":"([^"]+?)\s*(?:[–\-]|\|)\s*(?:Download|Meshy)/);
    if (rscTitleMatch && rscTitleMatch[1]) {
        title = rscTitleMatch[1];
    }

    // Try og:title in RSC or HTML
    if (!title) {
        const ogMatch = html.match(/\{"property":"og:title","content":"([^"]+)"\}/)
          || html.match(/<meta\s+property=["']og:title["']\s+content=["']([^"']+)["']/i);
        if (ogMatch && ogMatch[1]) {
            title = ogMatch[1];
        }
    }

    // Try <title> tag
    if (!title) {
        const titleTagMatch = html.match(/<title>([^<]+)<\/title>/i);
        if (titleTagMatch && titleTagMatch[1]) {
            title = titleTagMatch[1];
        }
    }

    // Fallback: parse title slug from URL path
    if (!title && shareUrl) {
        const slugMatch = shareUrl.match(/\/3d-models\/([a-zA-Z0-9_\-]+?)-[0-9a-f]{8}-[0-9a-f]{4}/i);
        if (slugMatch && slugMatch[1]) {
            title = slugMatch[1].replace(/[-_]/g, ' ');
        }
    }

    // Clean title suffixes
    if (title) {
        title = title
            .replace(/\s*[|\-]\s*Meshy(?:\s*AI)?\s*$/i, '')
            .replace(/\s*3D Model\s*$/i, '')
            .replace(/\s*[–-]\s*Download Free\s*$/i, '')
            .trim();
    }

    if (!title) {
        title = taskId ? `Model ${taskId.slice(0, 8)}` : 'Decrypted 3D Model';
    }

    return {
        shareUrl,
        modelUrl,
        previewUrl,
        title,
        taskId
    };
}

/**
 * Downloads the encrypted .meshy container from Meshy's CDN.
 *
 * @param {string} modelUrl 
 * @returns {Promise<Buffer>}
 */
export async function downloadEncryptedModel(modelUrl) {
    const resp = await fetch(modelUrl);
    if (!resp.ok) {
        throw new Error(`Failed to download encrypted model from CDN (HTTP ${resp.status}).`);
    }
    const arrayBuf = await resp.arrayBuffer();
    return Buffer.from(arrayBuf);
}
