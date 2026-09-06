"use client";

import {
  type ComponentProps,
  type ComponentType,
  createContext,
  type CSSProperties,
  type ReactNode,
  useContext,
  useMemo,
} from "react";
import * as RechartsPrimitive from "recharts";
import { cn } from "../lib/cn";

/**
 * Charts, ported from shadcn/ui's `chart` (registry `new-york-v4`) over Recharts.
 *
 * ── Rules this component cannot enforce, but every caller must follow ─────────────
 *
 *  - Assign chart slots in FIXED order — `chart-1`, then `chart-2`, and so on. Never
 *    cycled, and never by rank: colour follows the entity, so a filter that changes the
 *    series count must not repaint the survivors.
 *  - Bars, lines and stacked segments may use all six slots. Scatter, bubble and
 *    small-multiples are capped at THREE — slot 4 collapses against slot 2 under
 *    protanopia (0.2 ΔE). Past three there, fold the rest into "Other" or facet; adding a
 *    seventh hue does not fix it. The measured separations are in
 *    `packages/ui/src/styles/theme.css`'s header.
 *  - Never a second y-axis. Two measures of different scale are two charts, or one chart
 *    indexed to a common base.
 *  - A legend is present for two or more series. A single series needs none — the title
 *    names it — and identity is never carried by colour alone.
 *  - Status (over budget, overdue, failing) is never a chart slot. It takes
 *    success/warning/danger with an icon and a label beside it.
 *
 * ── Three deliberate departures from shadcn's source ──────────────────────────────
 *
 *  1. `label` is REQUIRED and becomes the container's accessible name. shadcn renders an
 *     unlabelled SVG; this package has no i18n of its own, so — exactly as with
 *     `Dialog.closeLabel` and `Button.loadingLabel` — the host app has to supply the
 *     string rather than inherit an untranslated default.
 *  2. `ChartConfig.color` is typed as `var(--sh-color-chart-N)` and nothing else. The
 *     repo's "no literal colour outside theme.css" rule has no lint rule behind it; here
 *     it is a compile error instead.
 *  3. shadcn's `ChartStyle` — a `<style dangerouslySetInnerHTML>` emitting one rule per
 *     theme, scoped by a generated `data-chart` id — is gone. It exists to give a chart
 *     different colours in light and dark. Our slots already flip themselves in
 *     theme.css, so one set of custom properties inherited from an inline `style` does
 *     the same job with no injected stylesheet, no id plumbing, and no dangerous HTML.
 */

/** The six validated categorical slots. See theme.css for why the order is fixed. */
export type ChartSlot = 1 | 2 | 3 | 4 | 5 | 6;

export type ChartConfig = Record<
  string,
  {
    /** Shown in the legend and the tooltip. Required — this package has no i18n. */
    label: string;
    icon?: ComponentType;
    /**
     * Typed to the token, not to a colour. A literal here would be invisible to review
     * and would ignore both tenant branding and dark mode.
     */
    color: `var(--sh-color-chart-${ChartSlot})`;
  }
>;

const ChartContext = createContext<{ config: ChartConfig } | null>(null);

function useChart() {
  const context = useContext(ChartContext);
  if (!context) {
    throw new Error("useChart must be used within a <ChartContainer />");
  }
  return context;
}

export interface ChartContainerProps extends Omit<ComponentProps<"div">, "children"> {
  config: ChartConfig;
  /**
   * The chart's accessible name — what a screen reader announces in place of the plot.
   * Say what the chart shows ("Teaching load by teacher"), not that it is a chart.
   */
  label: string;
  children: ComponentProps<typeof RechartsPrimitive.ResponsiveContainer>["children"];
}

export function ChartContainer({
  className,
  children,
  config,
  label,
  style,
  ...props
}: ChartContainerProps) {
  // One custom property per series, inherited by every mark below. A `<Bar
  // fill="var(--color-load)" />` then resolves through this to the theme token, which is
  // what makes a chart follow dark mode and tenant branding without re-rendering.
  const colorVariables = useMemo(
    () =>
      Object.fromEntries(
        Object.entries(config).map(([key, item]) => [`--color-${key}`, item.color]),
      ) as CSSProperties,
    [config],
  );

  return (
    <ChartContext.Provider value={{ config }}>
      <div
        data-slot="chart"
        // role="img" + a required label: without it a screen reader is handed a bag of
        // <path> elements and announces nothing useful.
        role="img"
        aria-label={label}
        className={cn(
          "flex justify-center text-xs",
          "[&_.recharts-cartesian-axis-tick_text]:fill-muted-foreground",
          "[&_.recharts-cartesian-grid_line[stroke='#ccc']]:stroke-border/60",
          "[&_.recharts-curve.recharts-tooltip-cursor]:stroke-border",
          "[&_.recharts-dot[stroke='#fff']]:stroke-transparent",
          "[&_.recharts-layer]:outline-hidden",
          "[&_.recharts-polar-grid_[stroke='#ccc']]:stroke-border",
          "[&_.recharts-radial-bar-background-sector]:fill-muted",
          "[&_.recharts-rectangle.recharts-tooltip-cursor]:fill-muted",
          "[&_.recharts-reference-line_[stroke='#ccc']]:stroke-border",
          "[&_.recharts-sector]:outline-hidden",
          "[&_.recharts-sector[stroke='#fff']]:stroke-transparent",
          "[&_.recharts-surface]:outline-hidden",
          className,
        )}
        style={{ ...colorVariables, ...style }}
        {...props}
      >
        {/* initialDimension keeps the first paint from being a zero-size chart:
            ResponsiveContainer needs ResizeObserver to resolve a percentage against its
            parent, and that has not run on the server or on the first client frame. */}
        <RechartsPrimitive.ResponsiveContainer initialDimension={{ width: 320, height: 200 }}>
          {children}
        </RechartsPrimitive.ResponsiveContainer>
      </div>
    </ChartContext.Provider>
  );
}

export const ChartTooltip = RechartsPrimitive.Tooltip;

/**
 * One series' entry in a tooltip or legend payload.
 *
 * Declared here rather than imported from Recharts on purpose. Recharts types its payload
 * generically over `ValueType`/`NameType`, both of which widen to `any` in practice, and
 * this repo lints with `strictTypeChecked` — adopting those types means roughly thirty
 * `no-unsafe-member-access` suppressions inside one component, which trades a real safety
 * net for a library's loose generics. Recharts clones the content element with its own
 * props at runtime, so a narrower surface here is structurally compatible and says
 * exactly which fields we actually read.
 */
export interface ChartPayloadItem {
  name?: string;
  dataKey?: string | number;
  value?: number | string;
  color?: string;
  /** Recharts marks hidden entries "none"; those are filtered out. */
  type?: string;
  payload?: Record<string, unknown>;
}

export interface ChartTooltipContentProps {
  active?: boolean;
  payload?: readonly ChartPayloadItem[];
  label?: unknown;
  labelFormatter?: (label: ReactNode, payload: readonly ChartPayloadItem[]) => ReactNode;
  formatter?: (
    value: ChartPayloadItem["value"],
    name: string,
    item: ChartPayloadItem,
    index: number,
    itemPayload: ChartPayloadItem["payload"],
  ) => ReactNode;
  className?: string;
  labelClassName?: string;
  /** Overrides the indicator colour for every row. */
  color?: string;
  indicator?: "line" | "dot" | "dashed";
  hideLabel?: boolean;
  hideIndicator?: boolean;
  nameKey?: string;
  labelKey?: string;
  /**
   * Formats each value for display. Optional, but pass one: the fallback is
   * `Number.toLocaleString()` with the runtime's own locale, which is not the viewer's —
   * a figure rendered as "1,234" for a reader whose app is in Urdu is a real defect, not
   * a cosmetic one. The dashboard's `formatCount`/`formatPercent` are the right argument.
   */
  valueFormatter?: (value: number) => string;
}

export function ChartTooltipContent({
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

  const tooltipLabel = useMemo(() => {
    if (hideLabel || !payload?.length) return null;

    const item = payload[0];
    const key = String(labelKey ?? item?.dataKey ?? item?.name ?? "value");
    const itemConfig = configForPayload(config, item, key);
    const value =
      !labelKey && typeof label === "string" ? (config[label]?.label ?? label) : itemConfig?.label;

    if (labelFormatter) {
      return (
        <div className={cn("font-medium", labelClassName)}>{labelFormatter(value, payload)}</div>
      );
    }
    if (!value) return null;
    return <div className={cn("font-medium", labelClassName)}>{value}</div>;
  }, [label, labelFormatter, payload, hideLabel, labelClassName, config, labelKey]);

  if (!active || !payload?.length) return null;

  const nestLabel = payload.length === 1 && indicator !== "dot";

  return (
    <div
      className={cn(
        // surface-raised + elevation-2 rather than shadcn's bg-background + shadow-xl: a
        // tooltip floats above the chart, which is what the raised plane and the second
        // elevation step are for.
        "grid min-w-[8rem] items-start gap-1.5 rounded-[var(--sh-radius)] border border-border/60 bg-surface-raised px-2.5 py-1.5 text-xs shadow-elevation-2",
        className,
      )}
    >
      {!nestLabel ? tooltipLabel : null}
      <div className="grid gap-1.5">
        {payload
          .filter((item) => item.type !== "none")
          .map((item, index) => {
            const key = String(nameKey ?? item.name ?? item.dataKey ?? "value");
            const itemConfig = configForPayload(config, item, key);
            const indicatorColor = color ?? fillOf(item.payload) ?? item.color;

            return (
              <div
                key={`${key}-${String(index)}`}
                className={cn(
                  "flex w-full flex-wrap items-stretch gap-2 [&>svg]:h-2.5 [&>svg]:w-2.5 [&>svg]:text-muted-foreground",
                  indicator === "dot" && "items-center",
                )}
              >
                {formatter && item.value !== undefined && item.name !== undefined ? (
                  formatter(item.value, item.name, item, index, item.payload)
                ) : (
                  <>
                    {itemConfig?.icon ? (
                      <itemConfig.icon />
                    ) : (
                      !hideIndicator && (
                        <div
                          aria-hidden="true"
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
                            } as CSSProperties
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
                          {itemConfig?.label ?? item.name}
                        </span>
                      </div>
                      {item.value != null && (
                        // tabular-nums in the body face, not shadcn's font-mono: figures
                        // need to align in a column, which is what tabular figures are
                        // for. A second typeface for small data labels is decoration.
                        <span className="font-medium text-foreground tabular-nums">
                          {formatValue(item.value, valueFormatter)}
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

export const ChartLegend = RechartsPrimitive.Legend;

export interface ChartLegendContentProps {
  className?: string;
  hideIcon?: boolean;
  payload?: readonly ChartPayloadItem[];
  /**
   * Declared here rather than inherited from Recharts' legend props, which deprecate it
   * in favour of `position`. Recharts still passes it at runtime, and all this component
   * needs from it is which side of the plot to pad.
   */
  verticalAlign?: "top" | "bottom" | "middle";
  nameKey?: string;
}

export function ChartLegendContent({
  className,
  hideIcon = false,
  payload,
  verticalAlign = "bottom",
  nameKey,
}: ChartLegendContentProps) {
  const { config } = useChart();

  if (!payload?.length) return null;

  return (
    <div
      className={cn(
        "flex items-center justify-center gap-4",
        verticalAlign === "top" ? "pb-3" : "pt-3",
        className,
      )}
    >
      {payload
        .filter((item) => item.type !== "none")
        .map((item, index) => {
          const key = String(nameKey ?? item.dataKey ?? "value");
          const itemConfig = configForPayload(config, item, key);

          return (
            <div
              key={`${key}-${String(index)}`}
              className="flex items-center gap-1.5 [&>svg]:h-3 [&>svg]:w-3 [&>svg]:text-muted-foreground"
            >
              {itemConfig?.icon && !hideIcon ? (
                <itemConfig.icon />
              ) : (
                <div
                  aria-hidden="true"
                  className="h-2 w-2 shrink-0 rounded-[2px]"
                  style={{ backgroundColor: item.color }}
                />
              )}
              {itemConfig?.label}
            </div>
          );
        })}
    </div>
  );
}

/** Recharts puts the resolved fill of a mark on the row it came from. */
function fillOf(itemPayload: ChartPayloadItem["payload"]): string | undefined {
  const fill = itemPayload?.fill;
  return typeof fill === "string" ? fill : undefined;
}

function formatValue(
  value: NonNullable<ChartPayloadItem["value"]>,
  valueFormatter?: (value: number) => string,
): ReactNode {
  if (typeof value === "number") {
    return valueFormatter ? valueFormatter(value) : value.toLocaleString();
  }
  return value;
}

/**
 * Resolves the config entry a payload row belongs to.
 *
 * A row can name its series either directly (`dataKey`) or through a field on the datum
 * — a stacked bar keyed by a category column, say — so both are checked before falling
 * back to the key itself.
 */
function configForPayload(
  config: ChartConfig,
  item: ChartPayloadItem | undefined,
  key: string,
): ChartConfig[string] | undefined {
  if (!item) return undefined;

  const fromItem = readStringField(item as unknown as Record<string, unknown>, key);
  const fromDatum = readStringField(item.payload, key);
  const configKey = fromItem ?? fromDatum ?? key;

  return config[configKey] ?? config[key];
}

function readStringField(source: Record<string, unknown> | undefined, key: string) {
  const value = source?.[key];
  return typeof value === "string" ? value : undefined;
}
