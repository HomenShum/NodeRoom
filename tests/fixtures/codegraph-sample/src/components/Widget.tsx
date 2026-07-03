// Fixture: component with a relative import, a render edge, and a data-testid selector.
import { Badge } from "./Badge";

export function Widget() {
  return (
    <section data-testid="widget-panel">
      <Badge tone="ok" />
    </section>
  );
}
