// Vite resolves image imports to their bundled URL.
declare module "*.png" {
  const src: string;
  export default src;
}

// `?raw` imports resolve to the file's text.
declare module "*?raw" {
  const text: string;
  export default text;
}
