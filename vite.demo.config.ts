import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { resolve } from "node:path";

const target = process.env.DEMO_TARGET === "pages" ? "pages" : "site";

const targets = {
  site: {
    base: "/try/",
    outDir: "website/try",
    // pets live at site root /pets/ on virtualpet.beer
    publicBase: "",
  },
  pages: {
    // Relative base works on GitHub Pages + jsDelivr without hard-coding the host.
    base: "./",
    outDir: "docs/web-demo",
    publicBase: ".",
  },
} as const;

const cfg = targets[target];

process.env.VITE_PUBLIC_BASE = cfg.publicBase;

/** Static web try-on — site (/try/) or portable GitHub demo (./). */
export default defineConfig({
  plugins: [react()],
  base: cfg.base,
  publicDir: false,
  define: {
    __FN_ASSET_BASE__: JSON.stringify(cfg.publicBase),
  },
  build: {
    outDir: cfg.outDir,
    emptyOutDir: true,
    rollupOptions: {
      input: resolve(__dirname, "demo.html"),
    },
  },
});
