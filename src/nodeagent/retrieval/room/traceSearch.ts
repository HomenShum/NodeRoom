export function traceMatches(traceLine: string, query: string): boolean {
  return query.toLowerCase().split(/\s+/).every((token) => traceLine.toLowerCase().includes(token));
}

