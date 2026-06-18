import { useEffect, useRef, useState } from "react";

function prefersReducedMotion(): boolean {
  return typeof window !== "undefined" && typeof window.matchMedia === "function"
    ? window.matchMedia("(prefers-reduced-motion: reduce)").matches
    : false;
}

/** NodeTextReveal — React Bits BlurText adapted to NodeRoom tokens.
 *  Reveals text with a per-word blur-to-sharp fade when it enters the viewport. Under
 *  prefers-reduced-motion, renders the full text immediately with no blur. */
export function NodeTextReveal({
  text,
  className,
  wordDelay = 60,
  blur = 6,
  duration = 600,
}: {
  text: string;
  className?: string;
  wordDelay?: number;
  blur?: number;
  duration?: number;
}) {
  const ref = useRef<HTMLSpanElement>(null);
  const [visible, setVisible] = useState(false);
  const words = text.split(" ");

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const prefersReduced = prefersReducedMotion();
    if (prefersReduced) { setVisible(true); return; }
    if (typeof IntersectionObserver !== "function") { setVisible(true); return; }

    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) {
          setVisible(true);
          observer.disconnect();
        }
      },
      { threshold: 0.2 },
    );
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  return (
    <span ref={ref} className={className}>
      {words.map((word, i) => (
        <span
          key={i}
          style={{
            display: "inline-block",
            opacity: visible ? 1 : 0,
            filter: visible ? "none" : `blur(${blur}px)`,
            transform: visible ? "none" : "translateY(4px)",
            transition: `opacity ${duration}ms var(--ease-out-expo) ${i * wordDelay}ms, filter ${duration}ms var(--ease-out-expo) ${i * wordDelay}ms, transform ${duration}ms var(--ease-out-expo) ${i * wordDelay}ms`,
          }}
        >
          {word}{i < words.length - 1 ? "\u00A0" : ""}
        </span>
      ))}
    </span>
  );
}
