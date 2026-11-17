#!/usr/bin/env node

import fs from 'fs';
import path from 'path';
import { decryptMeshyBuffer } from './lib/decrypter.mjs';
import { extractMeshyMetadata, downloadEncryptedModel } from './lib/extractor.mjs';

/**
 * Main CLI handler
 */
async function main() {
    const args = process.argv.slice(2);
    if (args.length === 0 || args.includes('-h') || args.includes('--help')) {
        console.log(`
Meshy AI 3D Model Extractor & Decrypter CLI
==========================================
Extracts and decrypts raw full-resolution 3D models (.glb) from Meshy shared links or encrypted .meshy files.

Usage:
  node extract_meshy.mjs <share-url-or-file> [-o output.glb]

Examples:
  node extract_meshy.mjs "https://www.meshy.ai/3d-models/Bullet-Rain-01a1e9b4-e914-77de-9458-b6625dea4cd6?utm_medium=referral-program&utm_source=meshy&utm_content=BBDLCQ&share_type=3d-models" -o bullet_rain.glb
  node extract_meshy.mjs encrypted_model.meshy -o decrypted.glb
`);
        process.exit(0);
    }

    const input = args[0];
    let outIdx = args.indexOf('-o');
    let outputPath = (outIdx !== -1 && args[outIdx + 1]) ? args[outIdx + 1] : null;

    let encryptedBuffer;
    let modelName = 'model';

    if (input.startsWith('http://') || input.startsWith('https://') || !fs.existsSync(input)) {
        console.log(`[1/3] Resolving Meshy share link: ${input}...`);
        const meta = await extractMeshyMetadata(input);
        console.log(`      Title: ${meta.title}`);
        console.log(`      Task ID: ${meta.taskId || 'N/A'}`);
        console.log(`      Found encrypted payload: ${meta.modelUrl}`);

        if (!outputPath) {
            const sanitizedTitle = meta.title.replace(/[^a-zA-Z0-9_\-]/g, '_').toLowerCase();
            outputPath = `${sanitizedTitle || 'model'}.glb`;
        }

        console.log(`[2/3] Downloading encrypted .meshy container...`);
        encryptedBuffer = await downloadEncryptedModel(meta.modelUrl);
    } else {
        console.log(`[1/3] Reading local encrypted file: ${input}...`);
        encryptedBuffer = fs.readFileSync(input);
        if (!outputPath) {
            const parsed = path.parse(input);
            outputPath = `${parsed.name}.glb`;
        }
    }

    console.log(`[3/3] Decrypting ${encryptedBuffer.length} bytes via WebAssembly crypto engine...`);
    const startTime = Date.now();
    const glbBuffer = await decryptMeshyBuffer(encryptedBuffer);
    const duration = ((Date.now() - startTime) / 1000).toFixed(2);

    console.log(`      Decryption successful in ${duration}s!`);
    console.log(`      Saving decrypted glTF 2.0 binary model (${(glbBuffer.length / 1024 / 1024).toFixed(2)} MB) to: ${outputPath}`);
    fs.writeFileSync(outputPath, glbBuffer);
    console.log(`Done! 3D model saved to ${outputPath}`);
}

main().catch(err => {
    console.error("Extraction Error:", err.message);
    process.exit(1);
});
