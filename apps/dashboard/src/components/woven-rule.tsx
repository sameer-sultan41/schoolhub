/**
 * The one signature element of the redesign: a woven marigold/indigo band that separates
 * a screen's header from its content. Used sparingly (once per screen) — see
 * docs/frontend-status.md's design notes for why: everything else stays quiet so this
 * stays memorable.
 *
 * `pathLength="1"` normalizes both paths to a fixed length regardless of their actual
 * geometry, so `stroke-dasharray`/`stroke-dashoffset` can animate a "drawing in" reveal
 * without knowing the real path length up front. `motion-reduce:[animation:none]` turns
 * the reveal off (renders fully drawn immediately) for prefers-reduced-motion, without a
 * separate CSS layer. `rtl:scale-x-[-1]` mirrors the whole graphic for the Urdu locale —
 * `preserveAspectRatio="none"` is what lets it stretch to fill any container width rather
 * than staying at a fixed intrinsic size.
 */
export function WovenRule({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 200 12"
      preserveAspectRatio="none"
      aria-hidden="true"
      className={`h-3 w-full rtl:scale-x-[-1] ${className ?? ""}`}
    >
      <path
        d="M0,6 Q12.5,0 25,6 T50,6 T75,6 T100,6 T125,6 T150,6 T175,6 T200,6"
        pathLength="1"
        fill="none"
        stroke="var(--sh-color-accent)"
        strokeWidth="3"
        strokeLinecap="round"
        className="[stroke-dasharray:1] [stroke-dashoffset:1] motion-safe:animate-[draw-in_900ms_ease-out_forwards] motion-reduce:[stroke-dashoffset:0]"
      />
      <path
        d="M0,6 Q12.5,12 25,6 T50,6 T75,6 T100,6 T125,6 T150,6 T175,6 T200,6"
        pathLength="1"
        fill="none"
        stroke="var(--sh-color-primary)"
        strokeWidth="3"
        strokeLinecap="round"
        className="[stroke-dasharray:1] [stroke-dashoffset:1] motion-safe:animate-[draw-in_900ms_ease-out_150ms_forwards] motion-reduce:[stroke-dashoffset:0]"
      />
    </svg>
  );
}
