// Wrangler's Text rule imports .md files as strings.
declare module "*.md" {
  const text: string;
  export default text;
}
