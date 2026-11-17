# Meshy AI 3D Model Extractor & Decrypter 🧊

[![Node.js](https://img.shields.io/badge/Node.js-20%2B-brightgreen.svg)](https://nodejs.org)
[![WebAssembly](https://img.shields.io/badge/Engine-WebAssembly-blueviolet.svg)](https://webassembly.org/)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)
[![3D: glTF 2.0](https://img.shields.io/badge/3D_Format-glTF_2.0_.glb-cyan.svg)](https://www.khronos.org/gltf/)

An open-source web application and high-performance CLI tool to **extract, decrypt, and download raw, uncompressed 3D models (`.glb`) from any public Meshy AI shareable link**.

Features an interactive **3D WebGL model previewer**, local `.meshy` file drag-and-drop support, and zero-loss geometry reconstruction with full PBR textures.

---

## ✨ Features

- 🌐 **Modern Web Interface**: Paste any shareable link (e.g. `https://www.meshy.ai/s/39mTE9`) to decrypt and download in seconds.
- 🎮 **Interactive 3D Preview**: Spin, pan, and inspect the decrypted 3D model directly in the browser with Google `<model-viewer>`.
- 📁 **Offline File Decryption**: Drag and drop any locally downloaded `.meshy` container to unlock it into a `.glb`.
- ⚡ **WebAssembly Crypto Engine**: Decrypts in <0.2 seconds in memory without quality loss or geometry downsampling.
- 🎨 **Full PBR Texture Preservation**: Restores high-resolution WebP diffuse, normal, and roughness maps embedded in standard glTF 2.0 binary.
- 💻 **Dedicated CLI**: Terminal command support for batch extraction and automated asset pipelines.
- 🚀 **REST API**: Simple endpoints for metadata extraction, streaming, and direct attachment downloads.

---

## 🚀 Quick Start (Web Application)

### 1. Clone & Install Dependencies

```bash
git clone https://github.com/Kabyik-Kayal/meshy_extractor.git
cd meshy_extractor
npm install
```

### 2. Launch the Web Server

```bash
npm start
```

Visit **`http://localhost:3000`** in your browser.

---

## 💻 CLI Usage

You can also run the extractor directly from your command line:

```bash
# Using npm script:
npm run cli https://www.meshy.ai/s/39mTE9

# With a custom output filename:
npm run cli https://www.meshy.ai/s/39mTE9 -o my_model.glb

# Directly decrypt a local .meshy file:
npm run cli encrypted_model.meshy -o decrypted.glb
```

---

## 📡 REST API Reference

The server exposes the following REST endpoints:

| Endpoint | Method | Description |
|---|---|---|
| `/api/extract` | `POST` | Resolves a share link and returns title, task ID, thumbnail, and signed payload URL. |
| `/api/process` | `POST` | Fetches the `.meshy` container, runs WASM decryption, caches result, and returns download URL. |
| `/api/download` | `GET` | Downloads the decrypted `.glb` model directly as an attachment (`Content-Disposition`). |
| `/api/model-stream` | `GET` | Streams raw `.glb` binary for live 3D WebGL viewers. |
| `/api/upload-decrypt` | `POST` | Accepts a multipart `.meshy` file upload and returns the decrypted `.glb`. |
| `/api/health` | `GET` | Server status and uptime health check. |

---

## 🔍 How Meshy AI Share Links Work

When viewing a 3D model on Meshy AI without an active subscription, direct GLB downloads are blocked in the web UI. Instead, the model is streamed to the browser using an encrypted container format with a `.meshy` extension.

### The Delivery Pipeline

1. **Next.js SSR Hydration**:
   - When a shared URL like `https://www.meshy.ai/s/39mTE9` is loaded, the HTML contains a server-rendered React state containing task metadata and a signed CDN URL:
     ```text
     https://api.meshy.ai/misc/cdn-models/.../tasks/<TASK_ID>/output/model.meshy?sign=<TIMESTAMP>-<HMAC>
     ```
2. **Encrypted Payload (`model.meshy`)**:
   - The `.meshy` file is an encrypted binary blob containing the full glTF 2.0 geometry, embedded WebP texture maps, and PBR materials.
3. **WebAssembly Decrypter Engine**:
   - The browser loads `mesh_loader.js` and `mesh_loader.wasm`.
   - Before decrypting, the WASM engine requires an **authorization token** computed via a client-side hashing routine using the internal key `"Meshy_Crypto_Key"`.
4. **Client-Side Authorization Signature**:
   - The signature is calculated by combining the hostname (`"www.meshy.ai"`) and the current millisecond timestamp (`Date.now()`).
   - The algorithm is a 64-bit FNV-1a hash variant coupled with a 64-bit Murmur3 avalanche finalizer:
     ```javascript
     function computeSignature(hostname, timestamp) {
         let r = BigInt("14695981039346656037");
         const n = BigInt("1099511628211");
         const a = BigInt("0xFFFFFFFFFFFFFFFF");
         const key = "Meshy_Crypto_Key";
         const msg = `${hostname}:${timestamp}`;
         
         for (let i = 0; i < key.length; i++) {
             r ^= BigInt(key.charCodeAt(i));
             r = (r * n) & a;
         }
         for (let i = 0; i < msg.length; i++) {
             r ^= BigInt(msg.charCodeAt(i));
             r = (r * n) & a;
         }
         r ^= r >> BigInt(33);
         r = (r * BigInt("0xff51afd7ed558ccd")) & a;
         r ^= r >> BigInt(33);
         r = (r * BigInt("0xc4ceb9fe1a85ec53")) & a;
         r ^= r >> BigInt(33);
         return r.toString(16).padStart(16, "0");
     }
     ```
5. **Decryption Execution**:
   - The engine is unlocked via:
     ```javascript
     instance.authorize("www.meshy.ai", timestamp, signature);
     ```
   - Once authorized, calling `instance.processMeshyFile(uint8EncryptedBuffer)` decrypts the container in memory and returns a standard, unencrypted `.glb` file.

---

## 🛠️ Project Structure

```
meshy_extractor/
├── lib/
│   ├── decrypter.mjs        # WebAssembly decryption logic & signature computation
│   └── extractor.mjs        # Share link resolver, metadata parser & CDN fetcher
├── public/
│   ├── index.html           # Modern dark-mode web application UI
│   ├── style.css            # Glassmorphism styling and responsive layout
│   ├── app.js               # Frontend controller, 3D viewer & upload handling
│   └── favicon.svg          # 3D isometric cube logo
├── extract_meshy.mjs        # Command-line extractor tool
├── mesh_loader.js           # Emscripten WASM runtime glue
├── mesh_loader.wasm         # Compiled WebAssembly crypto engine
├── server.mjs               # Express API and web server
├── package.json             # Scripts and dependencies
└── README.md                # Documentation and protocol guide
```

---

## ⚖️ License

This project is licensed under the [MIT License](LICENSE).
For educational and interoperability research purposes.
