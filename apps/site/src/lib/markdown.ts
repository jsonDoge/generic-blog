import { Marked } from "marked";

const marked = new Marked({ gfm: true, breaks: false });

/** Add ids to h2/h3 so the TOC and SERP jump-links work. */
marked.use({
  renderer: {
    heading({ tokens, depth }) {
      const text = this.parser.parseInline(tokens);
      const plain = text.replace(/<[^>]+>/g, "");
      const id = plain
        .toLowerCase()
        .replace(/[^a-z0-9\s-]/g, "")
        .trim()
        .replace(/\s+/g, "-");
      return `<h${depth} id="${id}">${text}</h${depth}>\n`;
    },
  },
});

export function renderMarkdown(md: string): string {
  return marked.parse(md, { async: false }) as string;
}

/** Extract h2 headings for a table of contents. */
export function extractToc(md: string): { id: string; text: string }[] {
  const out: { id: string; text: string }[] = [];
  for (const m of md.matchAll(/^##\s+(.+)$/gm)) {
    const text = m[1].trim().replace(/[#*_`]/g, "");
    const id = text
      .toLowerCase()
      .replace(/[^a-z0-9\s-]/g, "")
      .trim()
      .replace(/\s+/g, "-");
    out.push({ id, text });
  }
  return out;
}
