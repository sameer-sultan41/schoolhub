import { type VariantProps, cva } from "class-variance-authority";
import type { HTMLAttributes } from "react";
import { cn } from "../lib/cn";

/*
 * Two axes. `variant` says WHAT the badge means; `appearance` says how loudly it says it.
 *
 * `solid` is every badge this repo shipped before `appearance` existed, byte for byte, and
 * is the default — no existing call site passes `appearance`, so none of them moved.
 * `soft` is the tinted treatment a status COLUMN wants: one solid pill per row per status
 * column reads as a wall of colour, which is the whole reason the reference dashboard uses
 * a light chip there.
 *
 * ── Why the colour lives in compoundVariants ──────────────────────────────────────
 *
 * Each variant needs a different token pair per appearance. Putting the solid pair on the
 * `variant` axis and letting `soft` override it would make badgeVariants() emit CONFLICTING
 * utilities (`bg-success` and `bg-success/12` both), correct only once `cn`'s tailwind-merge
 * has run over them. `badgeVariants` is exported and callable on its own, so it has to be
 * right without that. The axes below therefore carry no colour at all.
 *
 * ── Why `soft` labels are `text-foreground`, not the hue ──────────────────────────
 *
 * The obvious recipe — `bg-success/12 text-success`, the hue as its own label — does NOT
 * clear WCAG AA in this palette, and no tint opacity fixes it. Measured (WCAG 2.1 relative
 * luminance, sRGB source-over compositing, worst of background/surface/surface-sunken/
 * surface-raised/muted), light mode, hue-as-text with NO tint at all:
 *
 *     primary 8.60   success 4.19   warning 2.05   danger 4.38   info 4.74
 *
 * Four of five are already at or under 4.5:1 before a single percent of tint is added,
 * because these tokens were chosen as FILLS carrying `-foreground` text (see theme.css:
 * "success — 4.8:1 on white"), not as text colours. Adding the tint then moves the
 * background TOWARD the label, so raising the opacity makes it strictly worse, not better:
 * success runs 4.19 → 3.99 → 3.80 → 3.61 → 3.26 as the tint goes 0 → 4% → 8% → 12% → 20%.
 * There is no darker step of any status hue to reach for either — `success-foreground`,
 * `danger-foreground` and `info-foreground` are WHITE in light mode — and theme.css forbids
 * inventing one.
 *
 * So `soft` keeps the hue where the hue is legal (the fill and the border) and takes its
 * label from the page's own ink, `--sh-color-foreground`, which flips with the scheme and
 * therefore cannot be caught out by it. That measures 6.81–19.61:1 for every variant, in
 * both schemes, across the default theme and all four presets in styles/presets/. `Alert`
 * already reached the same conclusion for the same reason — its `warning` variant is
 * `bg-warning/15 text-foreground` — this just applies it consistently.
 */
const badgeVariants = cva(
  "inline-flex w-fit shrink-0 items-center gap-1 rounded-full border px-2.5 py-0.5 text-xs font-medium whitespace-nowrap",
  {
    variants: {
      variant: {
        primary: "",
        secondary: "",
        outline: "",
        success: "",
        warning: "",
        danger: "",
        // Neutral state, not a status: a draft timetable, a covered period, a record
        // waiting on someone. Reads its own token pair rather than borrowing
        // `secondary`, which is a pale brand tint and therefore says "brand".
        info: "",
      },
      appearance: {
        solid: "",
        soft: "",
      },
    },
    compoundVariants: [
      // ── solid: unchanged from before `appearance` existed ───────────────────────
      {
        variant: "primary",
        appearance: "solid",
        class: "border-transparent bg-primary text-primary-foreground",
      },
      {
        variant: "secondary",
        appearance: "solid",
        class: "border-transparent bg-secondary text-secondary-foreground",
      },
      {
        variant: "outline",
        appearance: "solid",
        class: "border-border bg-transparent text-foreground",
      },
      {
        variant: "success",
        appearance: "solid",
        class: "border-transparent bg-success text-success-foreground",
      },
      {
        variant: "warning",
        appearance: "solid",
        class: "border-transparent bg-warning text-warning-foreground",
      },
      {
        variant: "danger",
        appearance: "solid",
        class: "border-transparent bg-danger text-danger-foreground",
      },
      {
        variant: "info",
        appearance: "solid",
        class: "border-transparent bg-info text-info-foreground",
      },

      // ── soft: hue in the fill and the border, page ink in the label ─────────────
      {
        variant: "primary",
        appearance: "soft",
        class: "border-primary/30 bg-primary/12 text-foreground",
      },
      // `secondary` is the one variant whose token pair is ALREADY a soft pair — a pale
      // brand tint (L .934 light / .326 dark) with its own ink. There is nothing to soften,
      // and tinting it further would erase it: `bg-secondary/12` over `--sh-color-surface`
      // is a 1.02:1 chip, i.e. invisible. Tempting to reach for `text-foreground` here for
      // symmetry with the rest — do not: brutalist and soft-pop both set `secondary` to a
      // BRIGHT fill in dark mode (yellow, cyan) whose paired ink is black, so the page's
      // near-white foreground lands at 1.07:1 and 1.86:1 on it respectively.
      // `secondary-foreground` is the only token that tracks it. Soft therefore renders as
      // solid does, deliberately.
      {
        variant: "secondary",
        appearance: "soft",
        class: "border-transparent bg-secondary text-secondary-foreground",
      },
      // `outline` has no hue to tint. Its soft form is the neutral chip that pairs with the
      // hued ones — a filled `muted` plane, border kept so it still reads as the outline
      // family. `text-muted-foreground` would have been the natural label and is rejected
      // on measurement: the neon preset's muted-foreground lands at 4.29:1 on `muted`.
      { variant: "outline", appearance: "soft", class: "border-border bg-muted text-foreground" },
      {
        variant: "success",
        appearance: "soft",
        class: "border-success/30 bg-success/12 text-foreground",
      },
      // /20 rather than /12, alone among the hues. Amber is by far the lightest token in
      // the palette (L .745, vs .395–.560 for the rest), so a 12% tint of it over
      // `--sh-color-surface` only separates the chip from the page by 1.10:1 while every
      // other hue reaches 1.17–1.22:1 — the chip effectively disappears. /20 restores
      // parity at 1.17:1 and costs nothing in label contrast (11.64:1, worst plane).
      // `Alert` tunes the same token the same way and for the same reason (/15 vs /10).
      {
        variant: "warning",
        appearance: "soft",
        class: "border-warning/30 bg-warning/20 text-foreground",
      },
      {
        variant: "danger",
        appearance: "soft",
        class: "border-danger/30 bg-danger/12 text-foreground",
      },
      { variant: "info", appearance: "soft", class: "border-info/30 bg-info/12 text-foreground" },
    ],
    defaultVariants: { variant: "secondary", appearance: "solid" },
  },
);

export interface BadgeProps
  extends HTMLAttributes<HTMLSpanElement>, VariantProps<typeof badgeVariants> {}

export function Badge({ className, variant, appearance, ...props }: BadgeProps) {
  return <span className={cn(badgeVariants({ variant, appearance }), className)} {...props} />;
}

/**
 * A status dot for the start of a badge — `<Badge variant="success" appearance="soft">
 * <BadgeDot />Active</Badge>`. The badge's own `gap-1` and `items-center` place it; this
 * adds no layout of its own.
 *
 * It paints `currentColor`, so it follows whatever the badge set its text to: the
 * `-foreground` ink on a solid badge, the page ink on a soft one. That is deliberately NOT
 * the variant hue, and the measurements are the reason. A dot is decorative here — the
 * label beside it carries the meaning, so WCAG 1.4.11's 3:1 for graphical objects does not
 * strictly bind — but a hue dot would fail even that: `warning` on its own tint measures
 * 1.90:1 in light mode, and `success`/`danger` land at 3.89/4.02:1. The inherited ink
 * clears 10:1 on every tint in every preset instead.
 *
 * A caller who wants the hue anyway can say so per instance — `<BadgeDot
 * className="text-success" />` — since `currentColor` reads this element's own colour.
 */
export function BadgeDot({ className, ...props }: HTMLAttributes<HTMLSpanElement>) {
  return (
    <span
      aria-hidden="true"
      className={cn("size-1.5 shrink-0 rounded-full bg-[currentColor]", className)}
      {...props}
    />
  );
}

export { badgeVariants };
