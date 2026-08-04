/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_PUBLIC_BASE?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}

/** Injected by vite.demo.config for GitHub Pages asset prefix. */
declare const __FN_ASSET_BASE__: string | undefined;
