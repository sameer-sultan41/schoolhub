import { render, screen } from "@testing-library/react";
import { Bar, BarChart, XAxis } from "recharts";
import { ChartContainer, type ChartConfig } from "../chart";

const config = {
  load: { label: "Periods taught", color: "var(--sh-color-chart-1)" },
  norm: { label: "Weekly norm", color: "var(--sh-color-chart-3)" },
} satisfies ChartConfig;

const data = [
  { teacher: "Ayesha", load: 24, norm: 20 },
  { teacher: "Bilal", load: 18, norm: 20 },
];

function renderBarChart(props: Partial<{ label: string }> = {}) {
  return render(
    <ChartContainer
      config={config}
      className="h-64"
      label={props.label ?? "Teaching load by teacher"}
    >
      <BarChart data={data}>
        <XAxis dataKey="teacher" />
        <Bar dataKey="load" fill="var(--color-load)" />
      </BarChart>
    </ChartContainer>,
  );
}

describe("ChartContainer", () => {
  it("renders one mark per row", () => {
    const { container } = renderBarChart();
    expect(container.querySelectorAll(".recharts-bar-rectangle")).toHaveLength(2);
  });

  it("exposes the plot to assistive tech by its required label", () => {
    renderBarChart({ label: "Teaching load by teacher" });
    expect(screen.getByRole("img", { name: "Teaching load by teacher" })).toBeInTheDocument();
  });

  it("maps every config key to a --color-* custom property on the container", () => {
    // This is what lets `fill="var(--color-load)"` resolve to the theme token, and so what
    // makes a chart follow dark mode and tenant branding without re-rendering.
    const { container } = renderBarChart();
    const root = container.querySelector<HTMLElement>('[data-slot="chart"]');

    expect(root?.style.getPropertyValue("--color-load")).toBe("var(--sh-color-chart-1)");
    expect(root?.style.getPropertyValue("--color-norm")).toBe("var(--sh-color-chart-3)");
  });

  it("injects no stylesheet — the colours are inherited custom properties", () => {
    // Metronic's own ChartContainer ships a ChartStyle companion that interpolates
    // ChartConfig colours into a dangerouslySetInnerHTML <style> block. That mechanism
    // is deliberately not ported (see chart.tsx's own ChartConfig doc comment) — colours
    // are always `var(--sh-color-chart-N)` tokens, already scheme-aware via theme.css,
    // and a reintroduced <style> block would mean the token layer had been bypassed in
    // favour of raw, caller-controlled CSS text.
    const { container } = renderBarChart();
    expect(container.querySelector("style")).toBeNull();
  });
});
