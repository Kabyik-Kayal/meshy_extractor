import express from 'express';
import cors from 'cors';
import multer from 'multer';
import path from 'path';
import { fileURLToPath } from 'url';
import { decryptMeshyBuffer } from './lib/decrypter.mjs';
import { extractMeshyMetadata, downloadEncryptedModel, normalizeMeshyUrl } from './lib/extractor.mjs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const PORT = process.env.PORT || 3000;

// Middleware
app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// Multer memory storage for .meshy file uploads (up to 200MB)
const upload = multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: 200 * 1024 * 1024 }
});

// In-memory cache for recently processed models (avoids re-downloading on instant download after preview)
// Max 10 items, 15-minute TTL
const modelCache = new Map();
const CACHE_TTL = 15 * 60 * 1000;

function setCache(key, data) {
    if (modelCache.size >= 10) {
        const oldestKey = modelCache.keys().next().value;
        modelCache.delete(oldestKey);
    }
    modelCache.set(key, { ...data, timestamp: Date.now() });
}

function getCache(key) {
    const cached = modelCache.get(key);
    if (!cached) return null;
    if (Date.now() - cached.timestamp > CACHE_TTL) {
        modelCache.delete(key);
        return null;
    }
    return cached;
}

/**
 * Health check endpoint
 */
app.get('/api/health', (req, res) => {
    res.json({
        status: 'ok',
        service: 'meshy-extractor-server',
        timestamp: new Date().toISOString()
    });
});

/**
 * Metadata extraction endpoint:
 * Inspects a Meshy share link or code and extracts title, taskId, preview thumbnail, and signed payload URL.
 */
app.post('/api/extract', async (req, res) => {
    try {
        const { url } = req.body;
        if (!url || typeof url !== 'string') {
            return res.status(400).json({ error: 'Please provide a valid Meshy shareable link or code.' });
        }

        const metadata = await extractMeshyMetadata(url);
        res.json({
            success: true,
            data: metadata
        });
    } catch (err) {
        console.error('Error in /api/extract:', err.message);
        res.status(500).json({
            error: err.message || 'Failed to extract model details from the provided link.'
        });
    }
});

/**
 * Process / Decrypt endpoint:
 * Fetches the encrypted payload, decrypts it to GLB, caches it, and returns stats.
 */
app.post('/api/process', async (req, res) => {
    try {
        const { url, modelUrl, title } = req.body;
        const targetModelUrl = modelUrl || (url ? (await extractMeshyMetadata(url)).modelUrl : null);

        if (!targetModelUrl) {
            return res.status(400).json({ error: 'Model URL could not be resolved.' });
        }

        // Check cache first
        let glbBuffer;
        const cached = getCache(targetModelUrl);
        let decryptionTime = 0;

        if (cached) {
            glbBuffer = cached.buffer;
        } else {
            const encryptedBuffer = await downloadEncryptedModel(targetModelUrl);
            const startTime = Date.now();
            glbBuffer = await decryptMeshyBuffer(encryptedBuffer);
            decryptionTime = ((Date.now() - startTime) / 1000).toFixed(2);

            setCache(targetModelUrl, {
                buffer: glbBuffer,
                title: title || 'model'
            });
        }

        res.json({
            success: true,
            sizeBytes: glbBuffer.length,
            sizeFormatted: (glbBuffer.length / (1024 * 1024)).toFixed(2) + ' MB',
            decryptionTimeSec: decryptionTime,
            downloadUrl: `/api/download?modelUrl=${encodeURIComponent(targetModelUrl)}&name=${encodeURIComponent(title || 'model')}`,
            streamUrl: `/api/model-stream?modelUrl=${encodeURIComponent(targetModelUrl)}`
        });
    } catch (err) {
        console.error('Error in /api/process:', err.message);
        res.status(500).json({
            error: err.message || 'Failed to download and decrypt 3D model.'
        });
    }
});

/**
 * Stream GLB model binary for live 3D viewer or direct fetch
 */
app.get('/api/model-stream', async (req, res) => {
    try {
        const { modelUrl, url } = req.query;
        let targetModelUrl = modelUrl;

        if (!targetModelUrl && url) {
            const meta = await extractMeshyMetadata(url);
            targetModelUrl = meta.modelUrl;
        }

        if (!targetModelUrl) {
            return res.status(400).send('Missing model URL.');
        }

        let glbBuffer;
        const cached = getCache(targetModelUrl);
        if (cached) {
            glbBuffer = cached.buffer;
        } else {
            const encryptedBuffer = await downloadEncryptedModel(targetModelUrl);
            glbBuffer = await decryptMeshyBuffer(encryptedBuffer);
            setCache(targetModelUrl, { buffer: glbBuffer, title: 'model' });
        }

        res.setHeader('Content-Type', 'model/gltf-binary');
        res.setHeader('Content-Length', glbBuffer.length);
        res.setHeader('Cache-Control', 'public, max-age=3600');
        res.send(glbBuffer);
    } catch (err) {
        console.error('Error in /api/model-stream:', err.message);
        res.status(500).send('Error streaming 3D model: ' + err.message);
    }
});

/**
 * Direct file download attachment endpoint:
 * Downloads the decrypted GLB with Content-Disposition header.
 */
app.get('/api/download', async (req, res) => {
    try {
        const { modelUrl, url, name } = req.query;
        let targetModelUrl = modelUrl;

        let sanitizedName = (name || 'model').replace(/[^a-zA-Z0-9_\-]/g, '_').replace(/_+/g, '_');
        if (!sanitizedName.toLowerCase().endsWith('.glb')) {
            sanitizedName += '.glb';
        }

        if (!targetModelUrl && url) {
            const meta = await extractMeshyMetadata(url);
            targetModelUrl = meta.modelUrl;
            if (!name && meta.title) {
                sanitizedName = meta.title.replace(/[^a-zA-Z0-9_\-]/g, '_').replace(/_+/g, '_') + '.glb';
            }
        }

        if (!targetModelUrl) {
            return res.status(400).send('Missing model URL or link.');
        }

        let glbBuffer;
        const cached = getCache(targetModelUrl);
        if (cached) {
            glbBuffer = cached.buffer;
        } else {
            const encryptedBuffer = await downloadEncryptedModel(targetModelUrl);
            glbBuffer = await decryptMeshyBuffer(encryptedBuffer);
            setCache(targetModelUrl, { buffer: glbBuffer, title: sanitizedName });
        }

        res.setHeader('Content-Type', 'model/gltf-binary');
        res.setHeader('Content-Disposition', `attachment; filename="${sanitizedName}"`);
        res.setHeader('Content-Length', glbBuffer.length);
        res.send(glbBuffer);
    } catch (err) {
        console.error('Error in /api/download:', err.message);
        res.status(500).send('Failed to prepare model download: ' + err.message);
    }
});

/**
 * Upload and decrypt an existing local .meshy file
 */
app.post('/api/upload-decrypt', upload.single('meshyFile'), async (req, res) => {
    try {
        if (!req.file || !req.file.buffer) {
            return res.status(400).json({ error: 'Please upload a valid .meshy encrypted file.' });
        }

        const originalName = req.file.originalname || 'uploaded_model.meshy';
        const baseName = path.parse(originalName).name.replace(/[^a-zA-Z0-9_\-]/g, '_');
        const outputFilename = `${baseName || 'decrypted_model'}.glb`;

        const glbBuffer = await decryptMeshyBuffer(req.file.buffer);

        res.setHeader('Content-Type', 'model/gltf-binary');
        res.setHeader('Content-Disposition', `attachment; filename="${outputFilename}"`);
        res.setHeader('Content-Length', glbBuffer.length);
        res.send(glbBuffer);
    } catch (err) {
        console.error('Error in /api/upload-decrypt:', err.message);
        res.status(500).json({ error: err.message || 'Failed to decrypt uploaded file.' });
    }
});

// Fallback to index.html for SPA routes
app.get('*', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// Start server
app.listen(PORT, () => {
    console.log(`====================================================`);
    console.log(`  Meshy AI 3D Extractor Web Server`);
    console.log(`  Running at: http://localhost:${PORT}`);
    console.log(`====================================================`);
});
