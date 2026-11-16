import { render, screen } from "@testing-library/react";
import { sectionProps } from "@/test-utils";
import { Faq } from "../faq";

const ITEMS = [
  { question: "When does the term start?", answer: "On 1 April." },
  { question: "Is there a bus service?", answer: "Yes, on every route." },
];

describe("Faq", () => {
  it("renders the heading and each question with its answer", () => {
    const { container } = render(Faq(sectionProps({ heading: "Questions", items: ITEMS })));

    expect(screen.getByRole("heading", { level: 2, name: "Questions" })).toBeInTheDocument();
    expect(container.querySelectorAll("details")).toHaveLength(2);
    expect(screen.getByText("When does the term start?").tagName).toBe("SUMMARY");
    expect(screen.getByText("Yes, on every route.")).toBeInTheDocument();
  });

  it("falls back to the default heading", () => {
    render(Faq(sectionProps({ items: ITEMS })));
    expect(screen.getByRole("heading", { name: "Frequently asked questions" })).toBeInTheDocument();
  });

  it.each([
    ["no items", { items: [] }],
    ["missing items", {}],
    ["an empty question", { items: [{ question: "", answer: "x" }] }],
    ["an over-long answer", { items: [{ question: "q", answer: "a".repeat(2001) }] }],
  ])("renders nothing for %s", (_name, props) => {
    expect(Faq(sectionProps(props))).toBeNull();
  });
});
