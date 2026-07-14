import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

/**
 * shadcn/ui + AI Elements class-name helper. Merges conditional class lists and
 * de-dupes conflicting Tailwind utilities. Used only by the AI Elements component
 * layer (src/components/ai-elements/**, src/components/ui/**); the rest of the app
 * stays on the bespoke .r-* system.
 */
export function cn(...inputs: ClassValue[]): string {
  return twMerge(clsx(inputs));
}
