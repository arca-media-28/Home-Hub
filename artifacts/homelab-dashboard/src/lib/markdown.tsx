import { useCallback } from "react";
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

// Copy button appearance: hidden until hover on pointer devices, always
// visible on touch (no hover). Confirmation state swaps the label briefly.
const COPY_BUTTON_CLASS = [
  "chat-code-copy absolute top-1 right-1 rounded px-1.5 py-0.5",
  "text-[10px] font-sans leading-none",
  "bg-background/80 text-foreground/80 border border-border",
  "opacity-0 transition-opacity",
  "group-hover/code:opacity-100 focus:opacity-100",
  "[@media(hover:none)]:opacity-100",
].join(" ");

// Wrap each <pre> in a positioned group container and add a copy button.
// The HTML is already sanitized; we only add our own static elements.
function addCopyButtons(html: string): string {
  const doc = new DOMParser().parseFromString(html, "text/html");
  doc.body.querySelectorAll("pre").forEach((pre) => {
    const wrapper = doc.createElement("div");
    wrapper.className = "relative group/code my-1";
    const button = doc.createElement("button");
    button.type = "button";
    button.setAttribute("data-copy-code", "");
    button.setAttribute("aria-label", "Copy code");
    button.className = COPY_BUTTON_CLASS;
    button.textContent = "Copy";
    pre.replaceWith(wrapper);
    wrapper.appendChild(pre);
    wrapper.appendChild(button);
  });
  return doc.body.innerHTML;
}

// Sanitized Markdown block for assistant chat bubbles. Copy-button clicks are
// handled by delegation since the markup comes from an HTML string.
export function MarkdownContent({ text }: { text: string }) {
  const handleClick = useCallback((e: React.MouseEvent<HTMLDivElement>) => {
    const target = e.target as HTMLElement;
    const button = target.closest<HTMLButtonElement>("button[data-copy-code]");
    if (!button) return;
    e.preventDefault();
    e.stopPropagation();
    const pre = button.parentElement?.querySelector("pre");
    const code = pre?.textContent ?? "";
    navigator.clipboard
      .writeText(code)
      .then(() => {
        button.textContent = "Copied!";
        button.setAttribute("aria-label", "Copied");
        window.setTimeout(() => {
          button.textContent = "Copy";
          button.setAttribute("aria-label", "Copy code");
        }, 1500);
      })
      .catch(() => {
        button.textContent = "Failed";
        window.setTimeout(() => {
          button.textContent = "Copy";
        }, 1500);
      });
  }, []);

  return (
    <div
      className={MARKDOWN_CLASS}
      onClick={handleClick}
      dangerouslySetInnerHTML={{ __html: addCopyButtons(renderMarkdown(text)) }}
    />
  );
}
