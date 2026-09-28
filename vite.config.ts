import { defineConfig } from "vite";

export default defineConfig({
  build: {
    target: "es2022", // top-level await for renderer.init()
    assetsInlineLimit: 0,
    chunkSizeWarningLimit: 1500, // three/webgpu alone is ~1 MB minified
  },
  server: {
    host: true, // reachable from a phone/console browser on the LAN
  },
});
