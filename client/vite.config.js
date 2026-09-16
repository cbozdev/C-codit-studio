import { defineConfig } from "vite";
import { resolve } from "node:path";

export default defineConfig({
  server: {
    port: 5173,
    proxy: {
      "/api": "http://localhost:3001",
    },
  },
  build: {
    rollupOptions: {
      input: {
        main: resolve(import.meta.dirname, "index.html"),
        obs: resolve(import.meta.dirname, "obs.html"),
        admin: resolve(import.meta.dirname, "admin.html"),
        terms: resolve(import.meta.dirname, "terms.html"),
        privacy: resolve(import.meta.dirname, "privacy.html"),
        tutorial: resolve(import.meta.dirname, "tutorial.html"),
      },
    },
  },
});
