import { createRoot } from "react-dom/client";
import { AiElementsShowcase } from "./AiElementsShowcase";

async function boot(): Promise<void> {
  await import("../tokens.css");
  await import("../../app/styles.css");
  await import("../primitives/primitives.css");
  await import("./ai-elements.css");
  const el = document.getElementById("root");
  if (el) createRoot(el).render(<AiElementsShowcase />);
}

void boot();
