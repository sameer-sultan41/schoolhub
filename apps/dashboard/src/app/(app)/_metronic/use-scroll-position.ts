import { useEffect, useState, type RefObject } from "react";

// Ported verbatim from Metronic's own hooks/use-scroll-position.ts.
interface UseScrollPositionProps {
  targetRef?: RefObject<HTMLElement | Document | undefined>;
}

export function useScrollPosition({ targetRef }: UseScrollPositionProps = {}): number {
  const [scrollPosition, setScrollPosition] = useState<number>(0);

  useEffect(() => {
    const target = targetRef?.current || document;
    const scrollable = target === document ? window : target;

    const updatePosition = () => {
      const scrollY = target === document ? window.scrollY : (target as HTMLElement).scrollTop;
      setScrollPosition(scrollY);
    };

    scrollable.addEventListener("scroll", updatePosition);
    updatePosition();

    return () => {
      scrollable.removeEventListener("scroll", updatePosition);
    };
  }, [targetRef]);

  return scrollPosition;
}
