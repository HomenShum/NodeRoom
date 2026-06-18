import { useEffect, useRef, useState, type CSSProperties, type ElementType, type HTMLAttributes, type ReactNode } from "react";

function prefersReducedMotion(): boolean {
  return typeof window !== "undefined" && typeof window.matchMedia === "function"
    ? window.matchMedia("(prefers-reduced-motion: reduce)").matches
    : false;
}

type NodeRevealProps = HTMLAttributes<HTMLElement> & {
  children: ReactNode;
  as?: ElementType;
  delay?: number;
  distance?: number;
  className?: string;
  threshold?: number;
  once?: boolean;
  style?: CSSProperties;
};

/** NodeReveal — React Bits AnimatedContent/FadeContent adapted to NodeRoom tokens.
 *  Fades + slides children in when they enter the viewport. Under prefers-reduced-motion
 *  the children render immediately in their final state (no transform, full opacity). */
export function NodeReveal({
  children,
  as: Tag = "div",
  delay = 0,
  distance = 12,
  className,
  threshold = 0.15,
  once = true,
  style,
  ...rest
}: NodeRevealProps) {
  const ref = useRef<HTMLElement>(null);
  const [visible, setVisible] = useState(false);

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
          if (once) observer.disconnect();
        } else if (!once) {
          setVisible(false);
        }
      },
      { threshold },
    );
    observer.observe(el);
    return () => observer.disconnect();
  }, [threshold, once]);

  return (
    <Tag
      ref={ref}
      className={className}
      {...rest}
      style={{
        ...style,
        opacity: visible ? 1 : 0,
        transform: visible ? "none" : `translateY(${distance}px)`,
        transition: `opacity var(--motion-slow) var(--ease-out-expo) ${delay}ms, transform var(--motion-slow) var(--ease-out-expo) ${delay}ms`,
      }}
    >
      {children}
    </Tag>
  );
}
