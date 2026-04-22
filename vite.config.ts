import { defineConfig } from "vite";
import { resolve } from "path";

// Output to docs/ so GitHub Pages can serve from main:/docs.
// Use a relative base so the site works whether served from a custom domain
// (CNAME) or from a subpath like /print/.
export default defineConfig({
  base: "./",
  build: {
    outDir: resolve(__dirname, "docs"),
    emptyOutDir: false, // never wipe docs/ (preserves CNAME and other static assets)
    sourcemap: false,
    target: "es2022",
  },
  server: {
    port: 5173,
  },
});
