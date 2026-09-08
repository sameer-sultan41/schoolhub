---
version: 1
name: SchoolHub Aurora
description: The design system for SchoolHub, a multi-tenant school-management SaaS. Aurora pairs a vivid indigo primary with a cyan accent on a faintly tinted canvas whose cards are pure white, and frames the app in a quiet recessed chrome that lets the content carry the colour. Every colour is expressed in OKLCH and measured against WCAG 2.1 rather than eyeballed; the chart ramp is additionally validated under simulated protanopia and deuteranopia. Type pairs a humanist sans (Inter) for body with a serif display face (Fraunces) for headings and a true tabular monospace (JetBrains Mono) for every figure, with Noto Nastaliq Urdu in the same stacks so Urdu renders without a separate rule.

colors:
  # Brand
  primary: "#515CE9"
  primary-foreground: "#FFFFFF"
  secondary: "#E6EAFC"
  secondary-foreground: "#363EA2"
  accent: "#28D6DF"
  accent-foreground: "#181F30"
  # Page surfaces (light)
  background: "#FCFDFF"
  surface: "#FFFFFF"
  surface-raised: "#FFFFFF"
  surface-sunken: "#F2F4FA"
  muted: "#EFF2F9"
  border: "#DBE0E9"
  # Text (light)
  foreground: "#181F30"
  muted-foreground: "#60697B"
  # Chrome — the app frame; one step BELOW the page in both schemes
  chrome: "#F4F6FA"
  chrome-foreground: "#181F30"
  chrome-muted: "#60697B"
  chrome-accent: "#E7EBF4"
  chrome-border: "#D9DEE8"
  chrome-primary: "#515CE9"
  # Status — semantics, never branding
  success: "#178257"
  warning: "#F0924A"
  danger: "#C1443C"
  info: "#007593"
  # Dark scheme
  dark-background: "#0E1321"
  dark-surface: "#192033"
  dark-surface-raised: "#21293F"
  dark-surface-sunken: "#131928"
  dark-foreground: "#EDF0F6"
  dark-muted-foreground: "#9BA5B8"
  dark-border: "#2A3249"
  dark-primary: "#8496F5"
  dark-chrome: "#090E1A"
  # Categorical chart ramp — FIXED ORDER, see Charts
  chart-1: "#515CE9"
  chart-2: "#B87D14"
  chart-3: "#0192A8"
  chart-4: "#4E8C1E"
  chart-5: "#D64A7B"
  chart-6: "#3E6BC4"

typography:
  page-title:
    fontFamily: "Fraunces, serif"
    fontSize: 30px
    fontWeight: 600
    lineHeight: 1.2
  section-title:
    fontFamily: "Fraunces, serif"
    fontSize: 16px
    fontWeight: 600
    lineHeight: 1.4
  body:
    fontFamily: "Inter, ui-sans-serif, system-ui, sans-serif"
    fontSize: 14px
    fontWeight: 400
    lineHeight: 1.5
  body-sm:
    fontFamily: "Inter, ui-sans-serif, system-ui, sans-serif"
    fontSize: 13px
    fontWeight: 400
    lineHeight: 1.5
  label:
    fontFamily: "Inter, ui-sans-serif, system-ui, sans-serif"
    fontSize: 12px
    fontWeight: 500
    lineHeight: 1.4
  section-label:
    fontFamily: "Inter, ui-sans-serif, system-ui, sans-serif"
    fontSize: 11px
    fontWeight: 600
    letterSpacing: 0.05em
    textTransform: uppercase
  figure:
    fontFamily: "JetBrains Mono, ui-monospace, SF Mono, Menlo, monospace"
    fontSize: 30px
    fontWeight: 700
    fontVariantNumeric: tabular-nums

rounded:
  sm: 6px
  md: 8px
  base: 10px
  lg: 10px
  xl: 14px
  full: 9999px

spacing:
  base: 4px
  scale: [4, 8, 12, 16, 24, 32, 48, 64]
  card-padding: 20px
  page-padding: 24px
  section-gap: 16px

elevation:
  1: "0 1px 2px -1px rgba(52,61,140,0.10), 0 1px 3px rgba(52,61,140,0.07)"
  2: "0 2px 4px -2px rgba(52,61,140,0.12), 0 8px 16px -4px rgba(52,61,140,0.10)"
  3: "0 8px 16px -6px rgba(52,61,140,0.16), 0 24px 40px -12px rgba(52,61,140,0.13)"

components:
  button:
    height: 40px
    height-sm: 32px
    radius: 10px
    primary: "bg primary, white label"
    outline: "1px border, transparent fill"
    ghost: "transparent, muted hover fill"
    outline-danger: "1px danger border, danger label, transparent fill — row-level destructive triggers"
    chrome-ghost: "transparent on the frame, chrome-accent hover fill"
  card:
    radius: 10px
    padding: 20px
    flat: "surface + elevation 1"
    raised: "surface-raised + elevation 2 — stat tiles"
    floating: "surface-raised + elevation 3 — popovers"
  badge:
    radius: 9999px
    solid: "hue fill, paired -foreground label"
    soft: "hue at 12% fill, hue at 30% border, PAGE INK label"
  table:
    row-height: 52px
    zebra: "even rows take surface-sunken"
    header: "surface-sunken, 11px uppercase label"
  sidebar:
    width: 256px
    width-collapsed: 48px
    surface: "chrome — one step below the page"
    active: "2px chrome-primary leading bar + chrome-primary at 15% fill + frame-ink label + hued icon"
    hover: "chrome-accent fill, no colour"
---

## Overview

SchoolHub is a multi-tenant school-management platform: one application serving many
schools, each with its own branding, isolated by PostgreSQL Row-Level Security. That
shapes the whole system — **a tenant can override the brand, so the design cannot depend
on the brand.** Structure, depth, spacing and the frame carry the product's character;
hue is the one layer a school is allowed to replace.

Aurora is the platform default, worn by any school that has not set its own colours. It
replaced "Ink & Brass", whose primary measured 9.92:1 on white (nearly black, so the hue
never registered) and whose brass accent measured 2.19:1 (unusable as text, so half the
brand was invisible). Both numbers are why this system now states a measured ratio next to
every colour decision.

**Implementation.** Every colour resolves through a `--sh-*` custom property in
`packages/ui/src/styles/theme.css`. Components reference token utilities (`bg-primary`,
`text-muted-foreground`) and never a literal. That indirection is what makes per-tenant
theming work at runtime, so it is a hard rule, not a convention.

## Colors

### Brand & Accent

| Role | Light | Dark | Measured |
| --- | --- | --- | --- |
| `primary` | `#515CE9` | `#8496F5` | 5.19:1 on white — passes AA **both** as text and as a white-on-it fill |
| `accent` | `#28D6DF` | `#28D6DF` | 9.27:1 with ink on it |
| `secondary` | `#E6EAFC` | `#2A3051` | 7.44:1 with its own foreground |

Primary sits at L .550 deliberately. Around 5:1 is the band where one colour works as text
*and* as a fill — go darker and it stops reading as a colour, go lighter and white text on
it fails. Accent is a light fill (L .800) that carries ink; it is **never** a text colour
on a light surface (2.06:1).

### Surface

Three planes, and the canvas/card relationship is inverted from the usual: **the page takes
a faint tint and cards are pure white**, not the reverse. A card cannot read as a card if
it is the same white as the page behind it — that was the old palette's mistake, and it
forced every card to lean on a 1px hairline.

`surface-sunken` is for wells that sit *behind* the page: zebra rows, empty-state recesses,
disabled controls. `surface-raised` is for anything floating above it.

### Chrome

The app frame — sidebar rail and header — is its own tier, sitting **one step below the
page in both schemes** so content reads as being on top of it. Recession is the constant;
the direction of the lightness step is not, which is why it cannot simply be `surface`.

An inverted ink frame was tried and pulled. A dark navy slab behind a light page is a
strong look, but it is a *template's* look, and it spends the page's entire colour budget
on furniture. The frame's job is to sit still and let the content carry the colour.

Chrome is **not tenant-overridable**. A frame is structure, not brand, and a school that
picked a pale brand colour would otherwise get an unreadable sidebar. The brand reaches
the frame through `chrome-primary`, which paints the active nav item and the focus ring.

### Semantic

`success #178257` · `warning #F0924A` · `danger #C1443C` · `info #007593`.

These are product semantics, not taste, and tenants cannot override them — a school that
could repaint `danger` could make a destructive action look safe. `info` is the neutral
informational state (a draft timetable, an unpublished plan).

Hues around the wheel: **danger 27° — warning 56° — success 160° — accent 200° — info 218°
— primary 274°.** Accent and info sit 18° apart and are separated by lightness and role
instead: accent is a light decorative fill, info a mid-tone state colour that is never a
large fill.

### Charts

Six slots, in a **fixed order that is a safety mechanism, not a preference**. Validated
against surface with protanopia and deuteranopia simulated at severity 1.0 (Machado
matrices, ΔE as Euclidean OKLab ×100):

- **Adjacent pairs** (bars, lines, stacked segments — only neighbours touch): worst
  colour-blind pair **9.0** against a floor of 8; worst normal-vision pair **17.0** against
  a floor of 15; every slot ≥ 3:1 on surface.
- **All pairs** (scatter, bubble, small multiples — any two marks can touch): capped at the
  **first three slots**. Slot 4 collapses against slot 2 under protanopia. Past three
  series in those forms, fold the rest into "Other" or facet.

Colour follows the entity, never its rank — a filter that changes the series count must not
repaint the survivors. Status is never carried by a chart colour.

## Typography

Three faces, each with a job. **Fraunces** (serif) for page and section titles — it is the
only thing giving the product a voice, since everything else is a grid of figures.
**Inter** for all body text and UI. **JetBrains Mono** for every figure, because a column
of numbers must align on the decimal and a value updating in place must not reflow its
tile.

Noto Nastaliq Urdu sits in the *same* stacks rather than behind a `[lang="ur"]` override:
browsers resolve font-family per character, so Urdu glyphs fall through the Latin faces
automatically in both locales.

A school may override the body and heading faces. It may **not** override the numeric
face — alignment is a legibility property, not a brand one.

## Layout

4px base unit. Page padding 24px, card padding 20px, 16px between sections. Sidebar 256px,
collapsing to a 48px icon rail. Content optionally caps at 96rem.

Nav is grouped under uppercase 11px section labels with wide tracking, with 16px between
groups — enough that each group reads as its own section rather than as lines in one long
list.

## Elevation & Depth

Three steps, each two layers — a tight contact shadow plus a wider ambient one, because a
single blurred shadow reads as a sticker rather than a raised surface.

Shadows carry the brand hue in light mode and fall back to depth-of-black in dark, where a
tinted shadow over a tinted dark surface is invisible. Use step 1 for cards on the page,
2 for stat tiles and panels that should read as their own object, 3 for things that float.

## Shapes

10px base radius, 6/8/14px for small/medium/large, full for pills and avatars. The base
radius is tenant-overridable, which is why the derived steps clamp at zero — a school
setting 0 must not produce a negative radius.

## Components

**Buttons.** One primary action per screen. Everything else is `outline` or `ghost`. A
row-level destructive trigger uses `outline-danger` — the same quiet weight as its
neighbouring Edit button, red only in the label and border — and the solid `danger` fill is
reserved for the confirm inside the dialog it opens. A wall of solid red down a table is
alarm fatigue, and it makes the one irreversible button no louder than the one that merely
opens a dialog.

**Badges.** Soft is the default for a status *column*: one solid pill per row reads as a
wall of colour. Soft keeps the hue in the fill and the border and takes its **label from
page ink** — the obvious `bg-success/12 text-success` recipe does not clear AA in this
palette, and no tint opacity fixes it, because tinting moves the background toward the
label.

**Sidebar.** Hover and active are two different treatments, never the same tint at two
strengths. Hover is neutral, so pointing at an item never reads as "this is the current
page". Active is coloured — leading bar, tint, hued icon — because it is the state that
must survive the pointer moving away. The active *label* takes frame ink for the same
measured reason badges do.

**Tables.** Even rows take `surface-sunken`. Twenty-four near-identical rows separated only
by hairlines cannot be scanned.

**Empty states.** Icon in a recessed roundel, a title, a sentence, and an action where one
exists. Never a bare line of grey text.

## Do's and Don'ts

**Do**

- Reference tokens (`bg-primary`, `text-muted-foreground`), never literals.
- State a measured contrast ratio when introducing or moving a colour.
- Let the accent bar, the icon and the weight carry meaning alongside hue.
- Keep the frame recessed from the page in both schemes.
- Use the numeric face for every figure.

**Don't**

- Don't put a hue in a text label on its own tint — measure it first; it usually fails.
- Don't use `accent` as text on a light surface.
- Don't repaint status colours or the chart ramp for a tenant.
- Don't reorder the chart ramp or cycle it for a seventh series.
- Don't use the spotlight gradient more than once per screen.
- Don't encode meaning in colour alone — pair it with an icon or a label.

## Responsive Behavior

Sidebar collapses to a 48px icon rail, then to a Sheet drawer below the mobile breakpoint;
the drawer closes on navigation. Stat tiles run 8-up on very wide screens, 4-up on desktop,
2-up on tablet, stacked on phones. Tables scroll horizontally inside their own container —
the page body never scrolls sideways. Direction is handled with logical properties
throughout (`start`/`end`, never `left`/`right`) because the product ships an RTL locale.
