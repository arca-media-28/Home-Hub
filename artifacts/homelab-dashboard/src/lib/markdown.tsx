import { marked } from "marked";
import DOMPurify from "dompurify";

// Renders trusted-ish Markdown (AI replies) as sanitized HTML. Parsing is
// synchronous (marked without async extensions) and the output is passed
// through DOMPurify so scripts/handlers can never reach the DOM.
marked.setOptions({ gfm: true, breaks: true });

export function renderMarkdown(text: string): string {
  const html = marked.parse(text, { async: false });
  return DOMPurify.sanitize(html, {
    USE_PROFILES: { html: true },
    // Links open safely; DOMPurify strips javascript: URLs already, and we
    // add rel/target via a hook below.
  });
}

// Force links to open in a new tab without opener access.
DOMPurify.addHook("afterSanitizeAttributes", (node) => {
  if (node.tagName === "A") {
    node.setAttribute("target", "_blank");
    node.setAttribute("rel", "noopener noreferrer");
  }
});

// Compact typography for chat bubbles: tight margins, readable lists, and
// scrollable code blocks that don't blow out the tile width.
const MARKDOWN_CLASS = [
  "chat-markdown break-words text-xs leading-relaxed",
  "[&>*]:my-1 [&>*:first-child]:mt-0 [&>*:last-child]:mb-0",
  "[&_ul]:list-disc [&_ol]:list-decimal [&_ul]:pl-4 [&_ol]:pl-4",
  "[&_li]:my-0.5",
  "[&_h1]:text-sm [&_h2]:text-sm [&_h3]:text-xs [&_h1]:font-bold [&_h2]:font-bold [&_h3]:font-bold",
  "[&_p]:whitespace-pre-wrap",
  "[&_code]:font-mono [&_code]:text-[11px] [&_code]:bg-foreground/10 [&_code]:rounded [&_code]:px-1 [&_code]:py-0.5",
  "[&_pre]:bg-foreground/10 [&_pre]:rounded [&_pre]:p-2 [&_pre]:overflow-x-auto",
  "[&_pre_code]:bg-transparent [&_pre_code]:p-0 [&_pre_code]:whitespace-pre",
  "[&_blockquote]:border-l-2 [&_blockquote]:border-foreground/30 [&_blockquote]:pl-2 [&_blockquote]:opacity-80",
  "[&_a]:underline",
  "[&_table]:text-[11px] [&_th]:text-left [&_th]:pr-2 [&_td]:pr-2",
  "[&_hr]:border-border",
].join(" ");

// Sanitized Markdown block for assistant chat bubbles.
export function MarkdownContent({ text }: { text: string }) {
  return (
    <div
      className={MARKDOWN_CLASS}
      dangerouslySetInnerHTML={{ __html: renderMarkdown(text) }}
    />
  );
}
