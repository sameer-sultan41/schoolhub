import { render, screen } from "@testing-library/react";
import { axe } from "jest-axe";
import { Bar, BarChart, Line, LineChart, XAxis } from "recharts";
import {
  ChartContainer,
  ChartLegend,
  ChartLegendContent,
  ChartTooltip,
  ChartTooltipContent,
  type ChartConfig,
} from "./chart";

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
    // shadcn's own version emits a <style> block per chart. Ours does not, and a
    // reintroduced one would mean the token layer had been bypassed.
    const { container } = renderBarChart();
    expect(container.querySelector("style")).toBeNull();
  });

  it("has no detectable accessibility violations", async () => {
    const { container } = renderBarChart();
    expect(await axe(container)).toHaveNoViolations();
  });
});

describe("ChartTooltipContent", () => {
  it("renders nothing while the tooltip is inactive", () => {
    const { container } = render(
      <ChartContainer config={config} className="h-64" label="Teaching load by teacher">
        <LineChart data={data}>
          <Line dataKey="load" />
          <ChartTooltip content={<ChartTooltipContent />} />
        </LineChart>
      </ChartContainer>,
    );

    expect(container.querySelector(".recharts-tooltip-wrapper")?.textContent).toBe("");
  });

  it("formats a value through the supplied formatter rather than the runtime locale", () => {
    render(<ChartTooltipContentHarness valueFormatter={(value) => `${String(value)} periods`} />);
    expect(screen.getByText("24 periods")).toBeInTheDocument();
  });

  it("names the series from the config rather than from the raw data key", () => {
    render(<ChartTooltipContentHarness />);

    // Twice, and both are correct: once as the tooltip's own label line and once beside
    // the value. What matters is that neither says "load".
    expect(screen.getAllByText("Periods taught")).toHaveLength(2);
    expect(screen.queryByText("load")).not.toBeInTheDocument();
  });
});

describe("ChartLegendContent", () => {
  it("names each series from the config rather than from the data key", () => {
    render(
      <ChartContainer config={config} className="h-64" label="Teaching load by teacher">
        <BarChart data={data}>
          <Bar dataKey="load" fill="var(--color-load)" />
          <Bar dataKey="norm" fill="var(--color-norm)" />
          <ChartLegend content={<ChartLegendContent />} />
        </BarChart>
      </ChartContainer>,
    );

    expect(screen.getByText("Periods taught")).toBeInTheDocument();
    expect(screen.getByText("Weekly norm")).toBeInTheDocument();
  });
});

/**
 * Recharts only renders tooltip content on a real hover, which jsdom cannot produce
 * (there is no layout for it to hit-test against). Rendering the content component
 * directly with the payload Recharts would have handed it tests the part we actually
 * wrote, rather than testing Recharts' hit-testing.
 */
function ChartTooltipContentHarness({
  valueFormatter,
}: {
  valueFormatter?: (value: number) => string;
}) {
  return (
    <ChartContainer config={config} className="h-64" label="Teaching load by teacher">
      <BarChart data={data}>
        <Bar dataKey="load" fill="var(--color-load)" />
        <ChartTooltip
          active
          defaultIndex={0}
          content={
            <ChartTooltipContent
              active
              valueFormatter={valueFormatter}
              payload={[
                {
                  name: "load",
                  dataKey: "load",
                  value: 24,
                  color: "var(--sh-color-chart-1)",
                  payload: data[0],
                },
              ]}
            />
          }
        />
      </BarChart>
    </ChartContainer>
  );
}
