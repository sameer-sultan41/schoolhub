import { render, screen } from "@testing-library/react";
import { sectionProps } from "@/test-utils";
import { RichText } from "../rich-text";

describe("RichText", () => {
  it("renders the section's block document", () => {
    render(
      RichText(
        sectionProps({
          body: {
            blocks: [
              { type: "heading", level: 2, text: "Our values" },
              { type: "paragraph", text: "Respect and curiosity." },
            ],
          },
        }),
      ),
    );

    expect(screen.getByRole("heading", { level: 2, name: "Our values" })).toBeInTheDocument();
    expect(screen.getByText("Respect and curiosity.")).toBeInTheDocument();
  });

  it.each([
    ["no body", {}],
    ["an empty document", { body: { blocks: [] } }],
    ["a body that is not a block document", { body: "<p>html</p>" }],
  ])("renders nothing for %s", (_name, props) => {
    expect(RichText(sectionProps(props))).toBeNull();
  });
});
