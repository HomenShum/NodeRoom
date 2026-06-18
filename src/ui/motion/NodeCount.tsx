import { useEffect, useRef, useState } from "react";

function prefersReducedMotion(): boolean {
  return typeof window !== "undefined" && typeof window.matchMedia === "function"
    ? window.matchMedia("(prefers-reduced-motion: reduce)").matches
    : false;
}

/** NodeCount — React Bits CountUp adapted to NodeRoom tokens.
 *  Animates from 0 to `value` when the element enters the viewport. Uses requestAnimationFrame
 *  with ease-out-expo for smooth deceleration. Under prefers-reduced-motion, renders the final
 *  value immediately with no animation. */
export function NodeCount({
  value,
  from = 0,
  duration = 1200,
  delay = 0,
  decimals = 0,
  prefix = "",
  suffix = "",
  className,
  ariaLabel,
}: {
  value: number;
  from?: number;
  duration?: number;
  delay?: number;
  decimals?: number;
  prefix?: string;
  suffix?: string;
  className?: string;
  ariaLabel?: string;
}) {
  const ref = useRef<HTMLSpanElement>(null);
  const [display, setDisplay] = useState(from);
  const displayRef = useRef(from);
  const [visible, setVisible] = useState(false);

  const setDisplayValue = (next: number) => {
    displayRef.current = next;
    setDisplay(next);
  };

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const prefersReduced = prefersReducedMotion();
    if (prefersReduced) { setVisible(true); setDisplayValue(value); return; }
    if (typeof IntersectionObserver !== "function") { setVisible(true); return; }

    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) {
          setVisible(true);
          observer.disconnect();
        }
      },
      { threshold: 0.3 },
    );
    observer.observe(el);
    return () => observer.disconnect();
  }, [value]);

  useEffect(() => {
    if (!visible) return;
    const prefersReduced = prefersReducedMotion();
    if (prefersReduced || duration <= 0 || displayRef.current === value) {
      setDisplayValue(value);
      return;
    }

    const startValue = displayRef.current;
    const delta = value - startValue;
    let frame = 0;
    const timeout = window.setTimeout(() => {
      const start = performance.now();
      const tick = (now: number) => {
        const elapsed = Math.max(0, now - start);
        const progress = Math.min(1, elapsed / duration);
        const eased = 1 - Math.pow(1 - progress, 4);
        setDisplayValue(startValue + delta * eased);
        if (progress < 1) frame = requestAnimationFrame(tick);
      };
      frame = requestAnimationFrame(tick);
    }, delay);
    return () => { window.clearTimeout(timeout); if (frame) cancelAnimationFrame(frame); };
  }, [visible, value, duration, delay]);

  const formatted = display.toLocaleString(undefined, {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  });

  return (
    <span ref={ref} className={className} aria-label={ariaLabel}>
      {prefix}{formatted}{suffix}
    </span>
  );
}
