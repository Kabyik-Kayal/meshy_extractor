import fs from 'fs';
import path from 'path';
import { fileURLToPath, pathToFileURL } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

/**
 * Computes the 64-bit authorization hash signature required by Meshy's WebAssembly decrypter.
 * Algorithm: 64-bit FNV-1a variant with Murmur3-style 64-bit avalanche mixing finalizer.
 *
 * @param {string} hostname e.g. "www.meshy.ai"
 * @param {number|bigint} timestamp Millisecond epoch timestamp (Date.now())
 * @returns {string} 16-character hex string signature
 */
export function computeSignature(hostname, timestamp) {
    let r = BigInt("14695981039346656037");
    const n = BigInt("1099511628211");
    const a = BigInt("0xFFFFFFFFFFFFFFFF");
    const key = "Meshy_Crypto_Key";
    const msg = `${hostname}:${timestamp}`;
    
    // Hash key bytes
    for (let i = 0; i < key.length; i++) {
        r ^= BigInt(key.charCodeAt(i));
        r = (r * n) & a;
    }
    // Hash message bytes (hostname:timestamp)
    for (let i = 0; i < msg.length; i++) {
        r ^= BigInt(msg.charCodeAt(i));
        r = (r * n) & a;
    }
    // Murmur3 64-bit avalanche mixing
    r ^= r >> BigInt(33);
    r = (r * BigInt("0xff51afd7ed558ccd")) & a;
    r ^= r >> BigInt(33);
    r = (r * BigInt("0xc4ceb9fe1a85ec53")) & a;
    r ^= r >> BigInt(33);

    return r.toString(16).padStart(16, "0");
}

/**
 * Initializes and returns the WASM loader instance.
 */
async function getWasmInstance() {
    const rootDir = path.resolve(__dirname, '..');
    const wasmPath = path.join(rootDir, 'mesh_loader.wasm');
    const jsPath = path.join(rootDir, 'mesh_loader.js');

    if (!fs.existsSync(wasmPath) || !fs.existsSync(jsPath)) {
        throw new Error(`WASM loader engine not found in ${rootDir}`);
    }

    const fileUrl = pathToFileURL(jsPath).href;
    const loaderModule = await import(fileUrl);
    const initLoader = loaderModule.default || loaderModule;
    const wasmBinary = fs.readFileSync(wasmPath);

    const instance = await initLoader({
        wasmBinary,
        locateFile: (file) => file.endsWith('.wasm') ? wasmPath : file
    });

    return instance;
}

/**
 * Decrypts a binary .meshy encrypted container buffer into a standard glTF 2.0 (.glb) buffer.
 *
 * @param {Buffer|Uint8Array|ArrayBuffer} encryptedBuffer 
 * @returns {Promise<Buffer>} Decrypted standard glTF 2.0 (.glb) binary buffer
 */
export async function decryptMeshyBuffer(encryptedBuffer) {
    const instance = await getWasmInstance();

    const hostname = "www.meshy.ai";
    const timestamp = Date.now();
    const signature = computeSignature(hostname, timestamp);

    const authorized = instance.authorize(hostname, timestamp, signature);
    if (!authorized) {
        throw new Error("Failed to authorize WASM decrypter module with computed signature.");
    }

    const uint8Input = new Uint8Array(encryptedBuffer);
    const result = instance.processMeshyFile(uint8Input);

    if (!result || !result.success) {
        throw new Error(result?.error || "Decryption failed inside WebAssembly processMeshyFile engine.");
    }

    return Buffer.from(result.data);
}
