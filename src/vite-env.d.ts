/// <reference types="vite/client" />

// CSS import declarations for TypeScript 6
declare module '*.css' {
  const css: string;
  export default css;
}
