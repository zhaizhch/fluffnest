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
    base: "/fluffnest/",
    outDir: "dist-pages",
    // GitHub Pages project site: https://zhaizhch.github.io/fluffnest/
    publicBase: "/fluffnest",
  },
} as const;

const cfg = targets[target];

process.env.VITE_PUBLIC_BASE = cfg.publicBase;

/** Static web try-on — site (/try/) or GitHub Pages (/fluffnest/). */
export default defineConfig({
  plugins: [react()],
  base: cfg.base,
  publicDir: false,
  define: {
    // Force-inject so spriteFor() can prefix /pets on GitHub Pages.
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
