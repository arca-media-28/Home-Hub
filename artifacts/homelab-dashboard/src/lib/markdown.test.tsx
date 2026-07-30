// @vitest-environment jsdom
import { describe, it, expect, vi } from "vitest";
import { render, fireEvent, waitFor } from "@testing-library/react";
import { renderMarkdown, MarkdownContent } from "./markdown";

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

describe("MarkdownContent copy button", () => {
  const md = "```js\nconst x = 1;\nconsole.log(x);\n```";

  it("adds a copy button to each fenced code block", () => {
    const { container } = render(
      <MarkdownContent text={`${md}\n\ntext\n\n${md}`} />,
    );
    const buttons = container.querySelectorAll("button[data-copy-code]");
    expect(buttons.length).toBe(2);
    expect(buttons[0].textContent).toBe("Copy");
  });

  it("copies the raw code and shows confirmation", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.assign(navigator, { clipboard: { writeText } });
    const { container } = render(<MarkdownContent text={md} />);
    const button = container.querySelector("button[data-copy-code]")!;
    fireEvent.click(button);
    expect(writeText).toHaveBeenCalledWith("const x = 1;\nconsole.log(x);\n");
    await waitFor(() => expect(button.textContent).toBe("Copied!"));
  });

  it("does not add a button when there is no code block", () => {
    const { container } = render(<MarkdownContent text="just **text**" />);
    expect(container.querySelector("button[data-copy-code]")).toBeNull();
  });
});
