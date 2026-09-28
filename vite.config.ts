import { defineConfig } from "vite";

export default defineConfig({
  build: {
    target: "es2022", // top-level await for renderer.init()
    assetsInlineLimit: 0,
    // three/webgpu alone is ~1.2 MB; Rapier's compat build (own chunk) inlines ~3 MB of WASM as base64.
    chunkSizeWarningLimit: 4500,
  },
  server: {
    host: true, // reachable from a phone/console browser on the LAN
  },
});
