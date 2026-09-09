"use client";

import * as React from "react";
import { cn } from "../lib/cn";
import * as RechartsPrimitive from "recharts";

/**
 * `ChartConfig.color` is a single string, not Metronic's own `color | theme` union.
 * Metronic's `theme` variant (`{ light: string; dark: string }`) exists to let a chart
 * pick a different literal colour per scheme without a token — its `ChartStyle`
 * companion applies it by interpolating those caller-supplied strings into a
 * `dangerouslySetInnerHTML` `<style>` block, one rule per scheme, scoped by a generated
 * `data-chart` id. Dropped entirely, not ported: this repo's own convention is that a
 * chart colour is always a `var(--sh-color-chart-N)` token, which already flips between
 * schemes via theme.css's own `.dark`/`prefers-color-scheme` rules — nothing here needs
 * a second, string-interpolated stylesheet to do the same job, and no current caller
 * uses the `theme` variant. `--color-${key}` is set directly as an inline style
 * property on the chart's own container instead (below), which is CSS custom-property
 * assignment through the DOM API, not string-built CSS.
 */
export type ChartConfig = {
  [k in string]: {
    label?: React.ReactNode;
    icon?: React.ComponentType;
    color?: string;
  };
};

type ChartContextProps = {
  config: ChartConfig;
};

const ChartContext = React.createContext<ChartContextProps | null>(null);

function useChart() {
  const context = React.useContext(ChartContext);

  if (!context) {
    throw new Error("useChart must be used within a <ChartContainer />");
  }

  return context;
}

function ChartContainer({
  id,
  className,
  children,
  config,
  label,
  style,
  ...props
}: React.ComponentProps<"div"> & {
  config: ChartConfig;
  children: React.ComponentProps<typeof RechartsPrimitive.ResponsiveContainer>["children"];
  /**
   * Accessible name for the chart. Not part of Metronic's own ChartContainer — kept as
   * an additive, required-in-practice convenience: without it, a screen reader is handed
   * a bag of `<path>` elements and announces nothing useful. This package has no i18n of
   * its own, so pass a translated string rather than relying on a default.
   */
  label?: string;
}) {
  const uniqueId = React.useId();
  const chartId = `chart-${id || uniqueId.replace(/:/g, "")}`;

  // One custom property per series, inherited by every mark below. A `<Bar
  // fill="var(--color-load)" />` then resolves through this to the theme token — see
  // the `ChartConfig` doc comment above for why this is plain inline style, not an
  // injected `<style>` tag.
  const colorVariables = React.useMemo(
    () =>
      Object.fromEntries(
        Object.entries(config)
          .filter(([, item]) => item.color)
          .map(([key, item]) => [`--color-${key}`, item.color]),
      ) as React.CSSProperties,
    [config],
  );

  return (
    <ChartContext.Provider value={{ config }}>
      <div
        data-slot="chart"
        data-chart={chartId}
        role="img"
        aria-label={label}
        className={cn(
          "flex aspect-video justify-center text-xs [&_.recharts-cartesian-axis-tick_text]:fill-muted-foreground [&_.recharts-cartesian-grid_line[stroke='#ccc']]:stroke-border/50 [&_.recharts-curve.recharts-tooltip-cursor]:stroke-border [&_.recharts-dot[stroke='#fff']]:stroke-transparent [&_.recharts-layer]:outline-hidden [&_.recharts-polar-grid_[stroke='#ccc']]:stroke-border [&_.recharts-radial-bar-background-sector]:fill-muted [&_.recharts-rectangle.recharts-tooltip-cursor]:fill-muted [&_.recharts-reference-line_[stroke='#ccc']]:stroke-border [&_.recharts-sector]:outline-hidden [&_.recharts-sector[stroke='#fff']]:stroke-transparent [&_.recharts-surface]:outline-hidden",
          className,
        )}
        style={{ ...colorVariables, ...style }}
        {...props}
      >
        <RechartsPrimitive.ResponsiveContainer>{children}</RechartsPrimitive.ResponsiveContainer>
      </div>
    </ChartContext.Provider>
  );
}

const ChartTooltip = RechartsPrimitive.Tooltip;

/**
 * Recharts' own payload item type isn't stable/usable across its major versions (its
 * generics changed shape from v2 to v3, which is exactly what broke this file when
 * copied verbatim into a v3 install) — hand-written here instead, covering only the
 * fields this file actually reads off one payload entry. Type-only addition, not a
 * behavior/variant change.
 */
interface ChartPayloadItem {
  value?: number | string;
  name?: string;
  dataKey?: string | number;
  color?: string;
  fill?: string;
  payload?: { fill?: string; [key: string]: unknown };
}

interface ChartTooltipContentProps {
  active?: boolean;
  payload?: ChartPayloadItem[];
  label?: React.ReactNode;
  className?: string;
  hideLabel?: boolean;
  hideIndicator?: boolean;
  indicator?: "line" | "dot" | "dashed";
  labelFormatter?: (label: React.ReactNode, payload: ChartPayloadItem[]) => React.ReactNode;
  labelClassName?: string;
  formatter?: (
    value: ChartPayloadItem["value"],
    name: ChartPayloadItem["name"],
    item: ChartPayloadItem,
    index: number,
    itemPayload: ChartPayloadItem["payload"],
  ) => React.ReactNode;
  color?: string;
  nameKey?: string;
  labelKey?: string;
  /**
   * Formats a numeric value for display. Optional — the fallback is
   * `Number.toLocaleString()` with the runtime's own locale, which is not
   * necessarily the viewer's. Not part of Metronic's own chart.tsx; kept as an
   * additive convenience so existing schoolhub chart call sites (which pass a
   * locale-aware formatter) don't need to switch to the raw `formatter` prop.
   */
  valueFormatter?: (value: number) => string;
}

function ChartTooltipContent({
  active,
  payload,
  className,
  indicator = "dot",
  hideLabel = false,
  hideIndicator = false,
  label,
  labelFormatter,
  labelClassName,
  formatter,
  color,
  nameKey,
  labelKey,
  valueFormatter,
}: ChartTooltipContentProps) {
  const { config } = useChart();

  const tooltipLabel = React.useMemo(() => {
    if (hideLabel || !payload?.length) {
      return null;
    }

    const [item] = payload;
    const key = `${labelKey || item?.dataKey || item?.name || "value"}`;
    const itemConfig = getPayloadConfigFromPayload(config, item, key);
    const value =
      !labelKey && typeof label === "string" ? config[label]?.label || label : itemConfig?.label;

    if (labelFormatter) {
      return (
        <div className={cn("font-medium", labelClassName)}>{labelFormatter(value, payload)}</div>
      );
    }

    if (!value) {
      return null;
    }

    return <div className={cn("font-medium", labelClassName)}>{value}</div>;
  }, [label, labelFormatter, payload, hideLabel, labelClassName, config, labelKey]);

  if (!active || !payload?.length) {
    return null;
  }

  const nestLabel = payload.length === 1 && indicator !== "dot";

  return (
    <div
      className={cn(
        "grid min-w-[8rem] items-start gap-1.5 rounded-lg border border-border/50 bg-background px-2.5 py-1.5 text-xs shadow-xl",
        className,
      )}
    >
      {!nestLabel ? tooltipLabel : null}
      <div className="grid gap-1.5">
        {payload.map((item, index) => {
          const key = `${nameKey || item.name || item.dataKey || "value"}`;
          const itemConfig = getPayloadConfigFromPayload(config, item, key);
          const indicatorColor = color || item.payload?.fill || item.color;

          return (
            <div
              key={item.dataKey}
              className={cn(
                "flex w-full flex-wrap items-stretch gap-2 [&>svg]:h-2.5 [&>svg]:w-2.5 [&>svg]:text-muted-foreground",
                indicator === "dot" && "items-center",
              )}
            >
              {formatter && item.value !== undefined && item.name ? (
                formatter(item.value, item.name, item, index, item.payload)
              ) : (
                <>
                  {itemConfig?.icon ? (
                    <itemConfig.icon />
                  ) : (
                    !hideIndicator && (
                      <div
                        className={cn(
                          "shrink-0 rounded-[2px] border-(--color-border) bg-(--color-bg)",
                          {
                            "h-2.5 w-2.5": indicator === "dot",
                            "w-1": indicator === "line",
                            "w-0 border-[1.5px] border-dashed bg-transparent":
                              indicator === "dashed",
                            "my-0.5": nestLabel && indicator === "dashed",
                          },
                        )}
                        style={
                          {
                            "--color-bg": indicatorColor,
                            "--color-border": indicatorColor,
                          } as React.CSSProperties
                        }
                      />
                    )
                  )}
                  <div
                    className={cn(
                      "flex flex-1 justify-between leading-none",
                      nestLabel ? "items-end" : "items-center",
                    )}
                  >
                    <div className="grid gap-1.5">
                      {nestLabel ? tooltipLabel : null}
                      <span className="text-muted-foreground">
                        {itemConfig?.label || item.name}
                      </span>
                    </div>
                    {item.value != null && (
                      <span className="font-mono font-medium text-foreground tabular-nums">
                        {typeof item.value === "number" && valueFormatter
                          ? valueFormatter(item.value)
                          : item.value.toLocaleString()}
                      </span>
                    )}
                  </div>
                </>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

const ChartLegend = RechartsPrimitive.Legend;

function ChartLegendContent({
  className,
  hideIcon = false,
  payload,
  verticalAlign = "bottom",
  nameKey,
}: React.ComponentProps<"div"> & {
  payload?: ChartPayloadItem[];
  verticalAlign?: "top" | "bottom";
  hideIcon?: boolean;
  nameKey?: string;
}) {
  const { config } = useChart();

  if (!payload?.length) {
    return null;
  }

  return (
    <div
      className={cn(
        "flex items-center justify-center gap-4",
        verticalAlign === "top" ? "pb-3" : "pt-3",
        className,
      )}
    >
      {payload.map((item) => {
        const key = `${nameKey || item.dataKey || "value"}`;
        const itemConfig = getPayloadConfigFromPayload(config, item, key);

        return (
          <div
            key={item.value}
            className={cn(
              "flex items-center gap-1.5 [&>svg]:h-3 [&>svg]:w-3 [&>svg]:text-muted-foreground",
            )}
          >
            {itemConfig?.icon && !hideIcon ? (
              <itemConfig.icon />
            ) : (
              <div
                className="h-2 w-2 shrink-0 rounded-[2px]"
                style={{
                  backgroundColor: item.color,
                }}
              />
            )}
            {itemConfig?.label}
          </div>
        );
      })}
    </div>
  );
}

// Helper to extract item config from a payload.
function getPayloadConfigFromPayload(config: ChartConfig, payload: unknown, key: string) {
  if (typeof payload !== "object" || payload === null) {
    return undefined;
  }

  const payloadPayload =
    "payload" in payload && typeof payload.payload === "object" && payload.payload !== null
      ? payload.payload
      : undefined;

  let configLabelKey: string = key;

  if (key in payload && typeof payload[key as keyof typeof payload] === "string") {
    configLabelKey = payload[key as keyof typeof payload];
  } else if (
    payloadPayload &&
    key in payloadPayload &&
    typeof payloadPayload[key as keyof typeof payloadPayload] === "string"
  ) {
    configLabelKey = payloadPayload[key as keyof typeof payloadPayload];
  }

  return configLabelKey in config ? config[configLabelKey] : config[key];
}

export { ChartContainer, ChartTooltip, ChartTooltipContent, ChartLegend, ChartLegendContent };
export type { ChartTooltipContentProps };
