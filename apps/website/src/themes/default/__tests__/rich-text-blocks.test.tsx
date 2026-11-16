import { render, screen } from "@testing-library/react";
import { RichTextBlocks } from "../rich-text-blocks";

const IMAGE_URL = "https://api.test.invalid/api/v1/public/files/t1/f1";

function renderDoc(blocks: unknown[]) {
  return render(<RichTextBlocks document={{ blocks }} />);
}

describe("RichTextBlocks", () => {
  it("renders a paragraph as text", () => {
    renderDoc([{ type: "paragraph", text: "Welcome to the new term." }]);
    expect(screen.getByText("Welcome to the new term.").tagName).toBe("P");
  });

  it.each([
    [2, 2],
    [3, 3],
    [4, 4],
  ])("renders a level-%i heading as an h%i", (level, expected) => {
    renderDoc([{ type: "heading", level, text: "Timings" }]);
    expect(screen.getByRole("heading", { level: expected, name: "Timings" })).toBeInTheDocument();
  });

  it("renders unordered and ordered lists", () => {
    const { container } = renderDoc([
      { type: "list", ordered: false, items: ["Uniform", "Books"] },
      { type: "list", ordered: true, items: ["Register", "Pay"] },
    ]);
    expect(container.querySelector("ul")).toHaveTextContent("UniformBooks");
    expect(container.querySelector("ol")).toHaveTextContent("RegisterPay");
    expect(screen.getAllByRole("listitem")).toHaveLength(4);
  });

  it("renders a quote", () => {
    const { container } = renderDoc([{ type: "quote", text: "Learning never exhausts the mind." }]);
    expect(container.querySelector("blockquote")).toHaveTextContent(
      "Learning never exhausts the mind.",
    );
  });

  it("renders an image from its public file URL with its alt text", () => {
    renderDoc([{ type: "image", file_url: IMAGE_URL, alt: "The new library" }]);
    expect(screen.getByRole("img", { name: "The new library" })).toBeInTheDocument();
  });

  it("renders nothing for an unknown block type, keeping the blocks around it", () => {
    const { container } = renderDoc([
      { type: "paragraph", text: "Before" },
      { type: "video", url: "https://example.test/v" },
      { type: "paragraph", text: "After" },
    ]);
    expect(container.querySelectorAll("p")).toHaveLength(2);
    expect(container).not.toHaveTextContent("example.test");
  });

  it("drops a malformed block and an image whose URL is not http(s)", () => {
    const { container } = renderDoc([
      { type: "heading", level: 1, text: "Too high" },
      { type: "image", file_url: "javascript:alert(1)", alt: "x" },
    ]);
    expect(container.querySelector("h1")).toBeNull();
    expect(container.querySelector("img")).toBeNull();
  });

  it("renders markup in text as literal text, never as HTML", () => {
    const { container } = renderDoc([{ type: "paragraph", text: "<b>bold</b><script>x</script>" }]);
    expect(container.querySelector("b")).toBeNull();
    expect(container.querySelector("script")).toBeNull();
    expect(screen.getByText("<b>bold</b><script>x</script>")).toBeInTheDocument();
  });

  it("renders nothing for an empty or invalid document", () => {
    expect(render(<RichTextBlocks document={{ blocks: [] }} />).container).toBeEmptyDOMElement();
    expect(render(<RichTextBlocks document="<p>html</p>" />).container).toBeEmptyDOMElement();
  });
});
