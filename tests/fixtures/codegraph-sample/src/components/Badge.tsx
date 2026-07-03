// Fixture: leaf component with its own selector.
export function Badge(props: { tone: string }) {
  return <span data-testid="widget-badge">{props.tone}</span>;
}
