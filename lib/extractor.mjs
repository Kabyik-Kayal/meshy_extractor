import { execFile } from 'child_process';
import util from 'util';
import fs from 'fs';

const execFilePromise = util.promisify(execFile);

const BROWSER_UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36';

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
 * - Full share URLs: https://www.meshy.ai/s/39mTE9
 * - Direct 3D model URLs: https://www.meshy.ai/3d-models/...
 * - Direct CDN model URLs: https://api.meshy.ai/misc/cdn-models/...
 * - Short codes: 39mTE9
 */
export function normalizeMeshyUrl(input) {
    if (!input || typeof input !== 'string') {
        throw new Error('A valid Meshy share URL or code is required.');
    }

    let trimmed = input.trim();

    // Direct CDN model link
    if (trimmed.startsWith('https://api.meshy.ai/misc/cdn-models/')) {
        return trimmed;
    }

    // Bare code like 39mTE9 or tasks id
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
 * Fetches page HTML using curl for highest reliability against Cloudflare anti-bot checks,
 * with standard fetch fallback.
 */
async function fetchPageContent(targetUrl) {
    const curlBinary = getCurlBinary();

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

        if (stdout && stdout.length > 500) {
            return stdout;
        }
    } catch (err) {
        console.warn(`[extractor] curl execution failed (${err.message}), falling back to fetch...`);
    }

    const resp = await fetch(targetUrl, {
        redirect: 'follow',
        headers: {
            'User-Agent': BROWSER_UA,
            'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8',
            'Accept-Language': 'en-US,en;q=0.9'
        }
    });

    if (!resp.ok && resp.status !== 301 && resp.status !== 302) {
        throw new Error(`Failed to fetch Meshy share page (HTTP ${resp.status}).`);
    }

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
            throw new Error('Meshy share page was temporarily challenged by Cloudflare. Please try again in a few moments.');
        }
        throw new Error('Could not find encrypted 3D model payload in the provided Meshy share link.');
    }
    const modelUrl = modelMatch[0];

    // 2. Extract Task ID
    const taskMatch = modelUrl.match(/\/tasks\/([a-zA-Z0-9\-]+)\//);
    const taskId = taskMatch ? taskMatch[1] : null;

    // 3. Extract Preview Image
    let previewUrl = null;
    const ogImageMatch = html.match(/<meta\s+property=["']og:image["']\s+content=["']([^"']+)["']/i);
    if (ogImageMatch && ogImageMatch[1]) {
        previewUrl = ogImageMatch[1];
    } else {
        const previewMatch = html.match(/https:\/\/api\.meshy\.ai\/misc\/cdn-images\/[^\s"'<>]+\/output\/preview(?:_watermark)?\.png\?sign=[a-zA-Z0-9_\-]+/);
        if (previewMatch) {
            previewUrl = previewMatch[0];
        }
    }

    // 4. Extract Model Title
    let title = 'Meshy 3D Model';
    const ogTitleMatch = html.match(/<meta\s+property=["']og:title["']\s+content=["']([^"']+)["']/i);
    if (ogTitleMatch && ogTitleMatch[1]) {
        title = ogTitleMatch[1];
    } else {
        const titleTagMatch = html.match(/<title>([^<]+)<\/title>/i);
        if (titleTagMatch && titleTagMatch[1]) {
            title = titleTagMatch[1];
        }
    }

    // Clean title suffixes
    title = title
        .replace(/\s*[|\-]\s*Meshy(?:\s*AI)?\s*$/i, '')
        .replace(/\s*3D Model\s*$/i, '')
        .trim();

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
