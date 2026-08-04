import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { resolve } from "node:path";

/** Static web try-on build for the marketing site / blog embed. */
export default defineConfig({
  plugins: [react()],
  base: "/try/",
  publicDir: false,
  build: {
    outDir: "website/try",
    emptyOutDir: true,
    rollupOptions: {
      input: resolve(__dirname, "demo.html"),
    },
  },
});
