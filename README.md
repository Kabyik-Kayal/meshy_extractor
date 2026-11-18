# Meshy 3D Model Extractor

[![Live Demo](https://img.shields.io/badge/Demo-meshy--model.onrender.com-blue?style=flat)](https://meshy-model.onrender.com/)
[![Node.js](https://img.shields.io/badge/Node.js-20%2B-green.svg?style=flat)](https://nodejs.org)
[![glTF 2.0](https://img.shields.io/badge/Output-glTF_2.0_.glb-blue.svg?style=flat)](https://www.khronos.org/gltf/)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg?style=flat)](https://opensource.org/licenses/MIT)

A utility and web application to extract and decrypt glTF 2.0 (`.glb`) 3D assets from Meshy shareable links and local `.meshy` encrypted archives.

Live deployment: [https://meshy-model.onrender.com](https://meshy-model.onrender.com)

---

## Features

- **Link Resolution**: Resolves both canonical URLs (`https://www.meshy.ai/3d-models/...`) and shortened links (`https://www.meshy.ai/s/...`).
- **In-Memory Decryption**: Decrypts `.meshy` binary containers into glTF 2.0 models using an Emscripten-compiled WebAssembly runtime.
- **Web Interface**: Browser-based UI with interactive 3D model inspection (via `<model-viewer>`) and local file upload support.
- **CLI Utility**: Command-line tool for headless model extraction and batch scripting.
- **REST API**: HTTP endpoints for metadata extraction, decryption, caching, and asset streaming.
- **Asset Preservation**: Preserves embedded geometry, UV layouts, and PBR textures (base color, metallic, roughness, and normal maps).

---

## Installation

### Prerequisites

- Node.js 18.0.0 or higher
- npm 9.0.0 or higher

### Setup

```bash
git clone https://github.com/Kabyik-Kayal/meshy_extractor.git
cd meshy_extractor
npm install
```

---

## Usage

### Web Interface

Start the local server:

```bash
npm start
```

Open `http://localhost:3000` in your browser.

### Command Line (CLI)

Extract a model directly using a share link:

```bash
node extract_meshy.mjs "https://www.meshy.ai/3d-models/Bullet-Rain-01a1e9b4-e914-77de-9458-b6625dea4cd6?utm_medium=referral-program&utm_source=meshy&utm_content=BBDLCQ&share_type=3d-models"
```

Save with a custom output filename:

```bash
node extract_meshy.mjs "https://www.meshy.ai/s/39mTE9" -o output_model.glb
```

Decrypt a previously downloaded `.meshy` file:

```bash
node extract_meshy.mjs path/to/model.meshy -o decrypted.glb
```

---

## API Reference

The Express server exposes the following HTTP endpoints:

| Endpoint | Method | Parameters | Description |
|---|---|---|---|
| `/api/extract` | `POST` | `{ "url": string }` | Resolves a share link and returns title, task ID, thumbnail, and signed model URL. |
| `/api/process` | `POST` | `{ "url": string }` or `{ "modelUrl": string }` | Downloads the encrypted archive, decrypts it to GLB in memory, and caches the result. |
| `/api/download` | `GET` | `?modelUrl=...&name=...` | Returns the decrypted `.glb` file as an attachment (`Content-Disposition`). |
| `/api/model-stream` | `GET` | `?modelUrl=...` | Streams the decrypted `.glb` binary (used by 3D viewports). |
| `/api/upload-decrypt` | `POST` | `multipart/form-data` (`file`) | Decrypts an uploaded `.meshy` file and returns the binary `.glb`. |
| `/api/health` | `GET` | None | Returns service status and uptime timestamp. |

---

## Technical Details

### Asset Delivery Mechanism

When viewing a model on Meshy, 3D assets are delivered inside an encrypted archive format with a `.meshy` extension rather than a plain `.glb` file.

1. **Metadata Hydration**:
   Public model pages load state via Next.js React Server Component (RSC) streams. The serialized state contains the signed CDN URL for the asset:
   ```text
   https://api.meshy.ai/misc/cdn-models/.../tasks/<TASK_ID>/output/model.meshy?sign=<TIMESTAMP>-<HMAC>
   ```

2. **Authorization Handshake**:
   The WebAssembly module (`mesh_loader.wasm`) requires an authorization signature before it permits decryption. The signature is derived from a 64-bit FNV-1a hash followed by a 64-bit Murmur3 avalanche finalizer using the internal key `"Meshy_Crypto_Key"`:

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

3. **Decryption**:
   Once authorized via `instance.authorize("www.meshy.ai", timestamp, signature)`, the module invokes `instance.processMeshyFile(buffer)`, returning the unpacked glTF 2.0 binary.

---

## Deployment

The project includes configuration for deployment on [Render](https://render.com).

1. Connect your repository to Render as a **Web Service**.
2. Configure settings:
   - **Environment**: `Node`
   - **Build Command**: `npm install`
   - **Start Command**: `npm start`
3. Alternatively, deploy using the included [`render.yaml`](render.yaml) blueprint.

---

## Directory Layout

```
meshy_extractor/
├── lib/
│   ├── decrypter.mjs        # WebAssembly runtime glue and crypto authorization
│   └── extractor.mjs        # URL resolver, metadata parser, and CDN fetcher
├── public/
│   ├── index.html           # Web application markup
│   ├── style.css            # Stylesheet
│   ├── app.js               # Client-side controller and 3D viewer binding
│   └── favicon.svg          # Application icon
├── extract_meshy.mjs        # Command-line interface
├── mesh_loader.js           # Emscripten runtime module
├── mesh_loader.wasm         # WebAssembly decryption binary
├── server.mjs               # Express application and API routes
├── package.json             # Package configuration and dependencies
├── render.yaml              # Render deployment specification
└── README.md                # Project documentation
```

---

## License

This project is licensed under the [MIT License](LICENSE).
