/** Motion primitives for the landing + #story surfaces, built on motion.dev
 *  (`motion/react`). Every animation here is transform/opacity only — no layout
 *  properties — and every entrance is one-shot (nothing loops).
 *
 *  Reduced motion: MotionRoot sets `reducedMotion="user"`, motion.dev's built-in
 *  support — under `prefers-reduced-motion: reduce` all transform animations
 *  (y-rise, scale settles, hover/tap springs) are dropped and entrances degrade
 *  to opacity-only fades. */
import { MotionConfig, motion, type HTMLMotionProps } from "motion/react";
import type { ReactNode } from "react";

export function MotionRoot({ children }: { children: ReactNode }) {
  return <MotionConfig reducedMotion="user">{children}</MotionConfig>;
}

const TAGS = {
  div: motion.div,
  span: motion.span,
  section: motion.section,
  p: motion.p,
  h1: motion.h1,
  h2: motion.h2,
  li: motion.li,
} as const;
type Tag = keyof typeof TAGS;

type RiseProps = {
  as?: Tag;
  /** stagger delay in ms */
  delay?: number;
  /** rise distance in px (transform only) */
  y?: number;
  /** true → play when scrolled into view (once); false → play on mount */
  inView?: boolean;
  children?: ReactNode;
} & Omit<HTMLMotionProps<"div">, "children">;

/** Entrance reveal: fade + rise, 500ms expo-out, one-shot. */
export function Rise({ as = "div", delay = 0, y = 10, inView = false, children, ...rest }: RiseProps) {
  const M = TAGS[as] as typeof motion.div;
  const visible = { opacity: 1, y: 0 };
  return (
    <M
      initial={{ opacity: 0, y }}
      {...(inView
        ? { whileInView: visible, viewport: { once: true, amount: 0.2 } }
        : { animate: visible })}
      transition={{ duration: 0.5, ease: [0.16, 1, 0.3, 1], delay: delay / 1000 }}
      {...rest}
    >
      {children}
    </M>
  );
}

/** Spring settle for a spreadsheet number the moment it commits. Key it on the value. */
export function Settle({ children, ...rest }: { children?: ReactNode } & Omit<HTMLMotionProps<"span">, "children">) {
  return (
    <motion.span
      style={{ display: "inline-block" }}
      initial={{ opacity: 0, scale: 1.12 }}
      animate={{ opacity: 1, scale: 1 }}
      transition={{ type: "spring", stiffness: 420, damping: 26 }}
      {...rest}
    >
      {children}
    </motion.span>
  );
}

/** Springy micro-feedback for drill buttons: hover/tap scale, transform-only. */
export function PressButton({ children, ...rest }: { children?: ReactNode } & Omit<HTMLMotionProps<"button">, "children">) {
  return (
    <motion.button
      whileHover={{ scale: 1.03 }}
      whileTap={{ scale: 0.96 }}
      transition={{ type: "spring", stiffness: 500, damping: 24 }}
      {...rest}
    >
      {children}
    </motion.button>
  );
}

/** Arrival of a new item into a feed or step log — the 'arrive' gesture. One-shot,
 *  transform/opacity only. spring=true uses the settle spring; false a 350ms ease-out. */
export function Arrive({ as = "div", y = 8, spring = false, delay = 0, children, ...rest }: { as?: Tag; y?: number; spring?: boolean; /** ms */ delay?: number; children?: ReactNode } & Omit<HTMLMotionProps<"div">, "children">) {
  const M = TAGS[as] as typeof motion.div;
  return (
    <M initial={{ opacity: 0, y }} animate={{ opacity: 1, y: 0 }}
      transition={spring ? { type: "spring", stiffness: 380, damping: 28, delay: delay / 1000 } : { duration: 0.3, ease: "easeOut", delay: delay / 1000 }}
      {...rest}>{children}</M>
  );
}
