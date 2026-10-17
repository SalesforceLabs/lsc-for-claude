// Vite resolves image imports to their bundled URL.
declare module "*.png" {
  const src: string;
  export default src;
}
