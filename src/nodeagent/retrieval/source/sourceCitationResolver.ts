export function evidenceId(conceptId: string, citationId?: string): string {
  return citationId ? `${conceptId}#${citationId}` : conceptId;
}

