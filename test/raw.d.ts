// Vite's `?raw` imports: a file's source text, used by tests that check what code never touches.
declare module "*?raw" {
  const source: string;
  export default source;
}
