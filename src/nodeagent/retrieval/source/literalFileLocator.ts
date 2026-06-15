export interface LiteralFileLocator {
  page?: number;
  row?: number;
  column?: string;
  bbox?: { x: number; y: number; width: number; height: number; unit?: "px" | "pt" | "normalized" };
}

export function describeLiteralLocator(locator: LiteralFileLocator): string {
  return [
    locator.page ? `page ${locator.page}` : "",
    locator.row !== undefined ? `row ${locator.row}` : "",
    locator.column ? `column ${locator.column}` : "",
    locator.bbox ? `bbox ${locator.bbox.x},${locator.bbox.y},${locator.bbox.width},${locator.bbox.height}` : "",
  ].filter(Boolean).join(" / ") || "whole source";
}

