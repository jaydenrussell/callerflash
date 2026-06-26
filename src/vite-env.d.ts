/// <reference types="vite/client" />

declare const __APP_VERSION__: string;
declare const __APP_REPO__: string;
declare const __APP_BUILD_TIMESTAMP__: number;

// CSS import declarations for TypeScript 6
declare module '*.css' {
  const css: string;
  export default css;
}
