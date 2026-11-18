# Architectural Advisory: Securing Web-Delivered 3D Assets

## 1. Executive Summary

This document outlines architectural recommendations for securing proprietary 3D assets delivered to web browsers via WebAssembly runtimes.

In the current architecture, unauthenticated clients can reconstruct full-resolution glTF 2.0 (`.glb`) models and embedded high-resolution PBR textures directly from public share links without completing a paid download transaction.

The underlying architectural concerns are:
- **CWE-602**: Client-Side Enforcement of Server-Side Security
- **CWE-321**: Use of Hard-coded Cryptographic Key
- **CWE-312**: Cleartext Storage of Sensitive Information

---

## 2. Root Cause Breakdown

### A. Static Client-Side Key Material
The WebAssembly runtime (`mesh_loader.wasm`) verifies an authorization signature passed to `instance.authorize(domain, timestamp, signature)`.
- The signature is calculated using a 64-bit FNV-1a hash followed by a 64-bit Murmur3 avalanche finalizer.
- The secret key (`"Meshy_Crypto_Key"`) is embedded within the client JavaScript and WebAssembly artifacts.
- Because the hashing algorithm and key material reside entirely on the client, any external agent can compute valid signatures offline without authenticating against a backend service.

### B. Full Asset Delivery to Untrusted Clients
The platform transmits the complete production asset (containing full-resolution meshes with 800,000+ faces and uncompressed PBR WebP texture sets) inside an encrypted `.meshy` container to unauthorized viewers. Once decrypted by the client runtime, the full model geometry becomes available in memory.

### C. Contiguous glTF Reconstruction in Memory
The WebAssembly function `processMeshyFile()` reconstructs a complete, contiguous glTF 2.0 binary (`.glb`) buffer in WebAssembly linear memory before returning it to the JavaScript caller. This allows external tools or browser extensions to read the linear memory buffer directly and export standard `.glb` files.

### D. Server Component Exposure via Edge Routing
Cloudflare Turnstile bot verification targets standard HTML navigation requests (`Accept: text/html`). Requests specifying Next.js React Server Component headers (`RSC: 1`, `Accept: text/x-component`) bypass HTML verification checks on datacenter IP ranges, exposing signed CDN asset URLs programmatically.

---

## 3. Recommended Remediation Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                 RECOMMENDED ARCHITECTURE                    │
└─────────────────────────────────────────────────────────────┘
  [Asset Ingestion / Generation Engine]
            │
            ├───> [1. Production Model] ───> Private Storage (No Public CDN)
            │     (Full geometry, 4K PBR)     (Requires active paid entitlement)
            │
            └───> [2. Web Preview Model] ──> Public CDN
                  • Decimated geometry (approx. 50k faces)
                  • Downscaled textures (1024x1024)
                  • Streamed directly into GPU vertex buffers
```

---

### Strategy 1: Dual-Asset Pipeline (Preview Decimation vs. Production Asset Separation)

The most robust protection against client-side asset theft is decoupling the public web preview model from the production model. This is the industry standard employed by major 3D marketplaces and interactive web platforms:

1. **Production Asset Storage:**
   The full-resolution asset (800,000+ faces, full-resolution textures) is stored exclusively in private cloud storage with no public CDN route. Access is restricted to an authenticated backend download endpoint that verifies account entitlements before generating single-use download links.

2. **Decimated Web Preview Generation:**
   During the asset generation pipeline, produce a lightweight preview variant reduced to approximately 10% of the original triangle count (e.g., using `meshoptimizer` or Blender decimation) with 1024x1024 textures.

3. **Security Outcome:**
   Even if a user extracts or intercepts the web model, they only obtain a low-density preview asset suitable for display. The full commercial asset is never transmitted to the browser during preview sessions.

---

### Strategy 2: Dynamic Ephemeral Key Exchange

If client-side encryption is retained to deter direct scraping, remove all static keys from client-facing code:

1. When the 3D viewer initializes, the browser generates an ephemeral WebCrypto key pair (`ECDH` or `RSA-OAEP`).
2. The browser submits its public key to an authenticated session endpoint (`POST /api/viewer/session-key`).
3. The server generates a random AES-256-GCM session key, wraps it with the client public key, and returns the ciphertext.
4. The WebAssembly decrypter unwraps the session key in memory, processes the encrypted stream, and immediately discards the key.
5. The session key expires on the server after 60 seconds.

---

### Strategy 3: Next.js Component Serialization & Edge WAF Policies

To prevent automated scraping of signed asset URLs:

1. **Decouple Asset URLs from Initial SSR Payloads:**
   Do not include signed CDN links in the serialized React Server Component flight payload. The client application should make an explicit, session-authenticated API request to obtain the viewer token after the page finishes mounting.

2. **Edge WAF Policies on Datacenter ASN Ranges:**
   Configure edge WAF rules (such as Cloudflare Managed Rules) to inspect incoming requests carrying `RSC: 1` headers from known datacenter Autonomous System Numbers (e.g., AWS, Render, DigitalOcean, GCP). Enforce managed challenges when flight requests originate from automated hosting providers rather than residential or mobile consumer networks.

3. **Short-Lived, IP-Restricted Presigned URLs:**
   Configure CDN signing keys so that preview URLs expire within 10 to 15 minutes and validate client IP addresses at the edge.

---

### Strategy 4: Direct-to-GPU Vertex Streaming

Client-side extraction tools rely on capturing contiguous `.glb` containers formed in WebAssembly linear memory.

To neutralize memory capture:
1. Refactor `mesh_loader.wasm` so that it does not assemble a complete glTF 2.0 container.
2. Have the WebAssembly runtime decrypt discrete vertex attribute slices (`POSITION`, `NORMAL`, `TEXCOORD_0`, `INDICES`) sequentially.
3. Stream each slice directly into WebGL or WebGPU Vertex Buffer Objects using `gl.bufferData(gl.ARRAY_BUFFER, ...)`.
4. Clear WebAssembly memory buffers immediately after transfer.
5. Because no contiguous glTF container is constructed in memory, external callers cannot dump a valid 3D file.

---

## 4. Architectural Comparison Matrix

| Approach | Architectural Layer | Implementation Complexity | Protection Level | Eliminates Commercial Theft? |
|---|---|---|---|---|
| **Dual-Asset Decimation** | Asset Pipeline & Storage | Moderate | Maximum | Yes (High-res asset never reaches browser) |
| **Direct-to-GPU Streaming** | Client WebAssembly Runtime | High | High | Yes (No contiguous 3D file in memory) |
| **Ephemeral Key Exchange** | Transport & Key Management | Moderate | High | Substantial (Eliminates static key reuse) |
| **WAF Datacenter Rules** | Edge Network | Low | Moderate | Substantial (Stops automated cloud scrapers) |
| **IP-Bound Signed URLs** | CDN Distribution | Low | Moderate | Partial (Prevents URL sharing and caching) |

---

## 5. Conclusion

Client-side cryptographic obfuscation cannot guarantee asset security if the decryption key and the full-resolution geometry are both delivered into an untrusted browser environment.

The definitive resolution is **Dual-Asset Decimation**: keeping the production model in private backend storage for authenticated downloads, while serving only an optimized, lightweight preview model to the browser viewer.
