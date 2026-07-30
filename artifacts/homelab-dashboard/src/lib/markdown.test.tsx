// @vitest-environment jsdom
import { describe, it, expect } from "vitest";
import { renderMarkdown } from "./markdown";

describe("renderMarkdown", () => {
  it("renders lists, emphasis, and code", () => {
    const html = renderMarkdown(
      "**bold** and *italic*\n\n- one\n- two\n\n`inline`\n\n```js\nconst x = 1;\n```",
    );
    expect(html).toContain("<strong>bold</strong>");
    expect(html).toContain("<em>italic</em>");
    expect(html).toContain("<ul>");
    expect(html).toContain("<li>one</li>");
    expect(html).toContain("<code>inline</code>");
    expect(html).toContain("<pre>");
    expect(html).toContain("const x = 1;");
  });

  it("strips script tags and event handlers", () => {
    const html = renderMarkdown(
      'hello <script>alert(1)</script> <img src=x onerror="alert(1)"> <a href="javascript:alert(1)">x</a>',
    );
    expect(html).not.toContain("<script");
    expect(html).not.toContain("onerror");
    expect(html).not.toContain("javascript:");
  });

  it("makes links open in a new tab safely", () => {
    const html = renderMarkdown("[site](https://example.com)");
    expect(html).toContain('target="_blank"');
    expect(html).toContain('rel="noopener noreferrer"');
    expect(html).toContain('href="https://example.com"');
  });
});
