# Technical Remediation Guide: Securing Web-Delivered 3D Assets

## 1. Executive Summary

This document provides a technical remediation architecture for securing web-delivered 3D assets on platforms utilizing client-side WebAssembly loaders. 

The current vulnerability allows unauthenticated users to extract full-resolution glTF 2.0 (`.glb`) models and high-resolution PBR textures from public share links without an active subscription. The vulnerability is classified under:
- **CWE-602**: Client-Side Enforcement of Server-Side Security
- **CWE-321**: Use of Hard-coded Cryptographic Key
- **CWE-312**: Cleartext Storage of Sensitive Information

---

## 2. Root Cause Analysis

The vulnerability is rooted in four architectural issues:

### A. Client-Side Cryptographic Determinism
The WebAssembly runtime (`mesh_loader.wasm`) enforces authorization by calling `instance.authorize(domain, timestamp, signature)`. 
- The required signature is derived using a 64-bit FNV-1a hash followed by a 64-bit Murmur3 avalanche finalizer.
- The secret key (`"Meshy_Crypto_Key"`) is hardcoded in the client-facing JavaScript and WebAssembly bundles.
- Because both the algorithm and key reside on the client, any external client can generate valid authorization tokens offline without communicating with an authentication server.

### B. High-Fidelity Asset Delivery to Unpaid Viewers
The platform serves the complete, full-resolution production asset (800,000+ faces, uncompressed vertex data, and full-resolution WebP diffuse, normal, and roughness maps) to the browser inside an encrypted `.meshy` container. 

Once the client-side WebAssembly decrypter executes, it unpacks the full geometry directly into memory.

### C. In-Memory Contiguous glTF Reconstruction
The WebAssembly function `processMeshyFile()` reconstructs a standard, valid glTF 2.0 binary (`.glb`) buffer contiguously in WebAssembly linear memory before returning it to JavaScript. Any client or browser extension can capture this memory buffer and save it directly as an unlocked `.glb` file.

### D. Next.js RSC Flight Header WAF Bypass
Cloudflare Turnstile bot protection targets standard HTML navigation requests (`Accept: text/html`). Next.js App Router route requests containing React Server Component headers (`RSC: 1`, `Accept: text/x-component`) bypass standard Turnstile challenges on datacenter IP addresses, exposing signed CDN asset URLs programmatically.

---

## 3. Phased Remediation Plan

```
┌─────────────────────────────────────────────────────────────┐
│                 RECOMMENDED ARCHITECTURE                    │
└─────────────────────────────────────────────────────────────┘
  [3D Generation Engine]
            │
            ├───> [1. Production Model] ───> Private Cold Storage (S3/GCS)
            │     (850k faces, 4K PBR)       (Requires paid session & checkout)
            │
            └───> [2. Web Preview Model] ──> Public CDN
                  • Decimated geometry (50k faces)
                  • Downscaled textures (1024x1024)
                  • Streamed directly to GPU VBOs
```

---

### Phase 1: Immediate Mitigations (Days 1 to 3)

#### 1. Strip Direct Asset URLs from Initial RSC Streams
Do not serialize signed CDN links directly into the public React Server Component tree during initial page loads.
- Require the client browser to make a separate, authenticated request (`POST /api/v2/viewer/token`) after completing front-end Turnstile verification.
- The endpoint should validate user session headers and return a single-use asset token.

#### 2. Cloudflare WAF Managed Rule for Datacenter RSC Scraping
Configure a Cloudflare WAF rule to challenge automated RSC router requests originating from commercial cloud datacenters:
```text
(http.request.uri.path contains "/3d-models/" and http.request.headers["rsc"] eq "1" and ip.src.asnum in {16509 14618 13335 396982 63949})
```
This blocks automated scrapers hosted on AWS, GCP, Render, DigitalOcean, and Hetzner from querying the flight router directly.

#### 3. Short-Lived, IP-Restricted CDN Signed URLs
Replace multi-year CDN signature expirations with short-lived tokens:
- Set URL expiration time to 15 minutes or less.
- Bind signed URL tokens to the client IP address (`Cloudflare-Signed-URL-Limits: ip=...`).

---

### Phase 2: Structural Architecture Fix (Weeks 1 to 2)

#### 1. Two-Tier Asset Generation (The Preview vs. Production Model)
This is the standard approach used by professional 3D asset marketplaces (such as Sketchfab and Unreal Engine Marketplace):
- **Production Asset:** The full-resolution model (800,000+ faces, full texture resolution) must be stored in private cloud storage with no public CDN route. It should only be accessible through an authenticated backend download endpoint that verifies user subscription status.
- **Preview Asset:** During generation, produce a decimated model (reduced to approximately 50,000 faces) with 1024x1024 texture maps.
- **Outcome:** Even if a user captures or decrypts the web viewer asset, they only obtain a low-poly preview mesh. The commercial value of the production model remains protected on the server.

#### 2. Dynamic Ephemeral Key Exchange (Eliminating Static Keys)
If encryption is retained to prevent casual network inspection, replace static keys with dynamic session keys:
1. When the 3D viewer initializes, the client generates an ephemeral WebCrypto key pair (`ECDH` or `RSA-OAEP`).
2. The client sends its public key to `POST /api/viewer/session-key`.
3. The server generates a random AES-256-GCM session key, encrypts it with the client's public key, and returns the wrapped key.
4. The WebAssembly decrypter unwraps the session key in memory and decrypts the preview stream.
5. The session key expires after 60 seconds.

---

### Phase 3: Advanced Client Protection (Weeks 3 to 4)

#### 1. Direct-to-GPU Buffer Streaming (Zero In-Memory GLB Containers)
Traditional client-side dumping relies on capturing the contiguous `.glb` buffer assembled in WebAssembly linear memory.

To eliminate this attack vector:
1. Modify `mesh_loader.wasm` so that it never constructs a glTF 2.0 container.
2. The WebAssembly runtime decrypts individual vertex attribute slices (`POSITION`, `NORMAL`, `TEXCOORD_0`, `INDICES`) in small chunks.
3. Each chunk is uploaded directly to WebGL/WebGPU Vertex Buffer Objects via `gl.bufferData(gl.ARRAY_BUFFER, ...)`.
4. The memory buffers in WebAssembly are immediately cleared (`memset` to zero).
5. Because no contiguous glTF or GLB binary ever exists in system memory, automated tools cannot dump a valid 3D container.

---

## 4. Remediation Comparison Matrix

| Remediation Strategy | Implementation Time | Implementation Complexity | Security Impact | Prevents Asset Extraction? |
|---|---|---|---|---|
| **WAF Datacenter RSC Rules** | 1 Day | Low | Medium | Stops automated cloud scrapers |
| **Short-Lived IP-Bound URLs** | 2 Days | Low | Medium | Stops link sharing and reuse |
| **Two-Tier Asset Decimation** | 1 Week | Moderate | Maximum | Yes (Production asset is never sent to browser) |
| **Dynamic Ephemeral Key Exchange**| 1 Week | Moderate | High | Eliminates static key decryption |
| **Direct-to-GPU VBO Streaming** | 2 to 3 Weeks | High | High | Prevents in-memory GLB reconstruction |

---

## 5. Conclusion

Client-side cryptographic obfuscation cannot protect high-value assets if the decryption key and full-resolution data are delivered to an untrusted client environment. 

The most robust and permanent defense is **Two-Tier Asset Generation**: strictly decoupling the public web preview model from the private production model.
