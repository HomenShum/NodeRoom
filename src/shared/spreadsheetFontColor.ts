/** Normalize supported spreadsheet font colors to canonical uppercase AARRGGBB. */
export function normalizeSpreadsheetFontColor(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const hex = value.trim().replace(/^#/, "");
  if (!/^(?:[0-9a-fA-F]{6}|[0-9a-fA-F]{8})$/.test(hex)) return undefined;
  return (hex.length === 6 ? `FF${hex}` : hex).toUpperCase();
}

export type SpreadsheetFontColorSource = {
  argb?: unknown;
  theme?: unknown;
  tint?: unknown;
  indexed?: unknown;
};

const THEME_COLOR_SLOTS = [
  "lt1",
  "dk1",
  "lt2",
  "dk2",
  "accent1",
  "accent2",
  "accent3",
  "accent4",
  "accent5",
  "accent6",
  "hlink",
  "folHlink",
] as const;

// ECMA-376's legacy indexed palette. Indices 64 and 65 are automatic system
// colors, so they intentionally remain unresolved.
const INDEXED_COLORS = [
  "FF000000", "FFFFFFFF", "FFFF0000", "FF00FF00", "FF0000FF", "FFFFFF00", "FFFF00FF", "FF00FFFF",
  "FF000000", "FFFFFFFF", "FFFF0000", "FF00FF00", "FF0000FF", "FFFFFF00", "FFFF00FF", "FF00FFFF",
  "FF800000", "FF008000", "FF000080", "FF808000", "FF800080", "FF008080", "FFC0C0C0", "FF808080",
  "FF9999FF", "FF993366", "FFFFFFCC", "FFCCFFFF", "FF660066", "FFFF8080", "FF0066CC", "FFCCCCFF",
  "FF000080", "FFFF00FF", "FFFFFF00", "FF00FFFF", "FF800080", "FF800000", "FF008080", "FF0000FF",
  "FF00CCFF", "FFCCFFFF", "FFCCFFCC", "FFFFFF99", "FF99CCFF", "FFFF99CC", "FFCC99FF", "FFFFCC99",
  "FF3366FF", "FF33CCCC", "FF99CC00", "FFFFCC00", "FFFF9900", "FFFF6600", "FF666699", "FF969696",
  "FF003366", "FF339966", "FF003300", "FF333300", "FF993300", "FF993366", "FF333399", "FF333333",
] as const;

const themePaletteCache = new Map<string, ReadonlyMap<number, string>>();

/** Parse an Office theme's color scheme into the numeric indices used by cell styles. */
export function spreadsheetThemePalette(themeXml: unknown): ReadonlyMap<number, string> {
  if (typeof themeXml !== "string" || !themeXml.trim()) return new Map();
  const cached = themePaletteCache.get(themeXml);
  if (cached) return cached;
  const palette = new Map<number, string>();
  const scheme = themeXml.match(/<(?:[A-Za-z_][\w.-]*:)?clrScheme\b[^>]*>[\s\S]*?<\/(?:[A-Za-z_][\w.-]*:)?clrScheme>/i)?.[0] ?? themeXml;
  THEME_COLOR_SLOTS.forEach((slot, index) => {
    const block = scheme.match(new RegExp(
      `<(?:[A-Za-z_][\\w.-]*:)?${slot}\\b[^>]*>([\\s\\S]*?)<\\/(?:[A-Za-z_][\\w.-]*:)?${slot}>`,
      "i",
    ))?.[1];
    if (!block) return;
    const explicit = block.match(/<(?:[A-Za-z_][\w.-]*:)?srgbClr\b[^>]*\bval=["']([0-9a-f]{6}|[0-9a-f]{8})["']/i)?.[1];
    const system = block.match(/<(?:[A-Za-z_][\w.-]*:)?sysClr\b[^>]*\blastClr=["']([0-9a-f]{6}|[0-9a-f]{8})["']/i)?.[1]
      ?? block.match(/<(?:[A-Za-z_][\w.-]*:)?sysClr\b[^>]*\bval=["']([0-9a-f]{6}|[0-9a-f]{8})["']/i)?.[1];
    const color = normalizeSpreadsheetFontColor(explicit ?? system);
    if (color) palette.set(index, color);
  });
  if (themePaletteCache.size >= 32) themePaletteCache.delete(themePaletteCache.keys().next().value ?? "");
  themePaletteCache.set(themeXml, palette);
  return palette;
}

/** Resolve an ExcelJS/OpenXML color token to its effective canonical ARGB color. */
export function resolveSpreadsheetFontColor(
  color: SpreadsheetFontColorSource | null | undefined,
  themeXml?: unknown,
): string | undefined {
  if (!color) return undefined;
  const explicit = normalizeSpreadsheetFontColor(color.argb);
  if (explicit) return applySpreadsheetColorTint(explicit, color.tint);

  const theme = finiteInteger(color.theme);
  if (theme !== undefined) {
    const resolved = spreadsheetThemePalette(themeXml).get(theme);
    return resolved ? applySpreadsheetColorTint(resolved, color.tint) : undefined;
  }

  const indexed = finiteInteger(color.indexed);
  const resolved = indexed === undefined ? undefined : INDEXED_COLORS[indexed];
  return resolved ? applySpreadsheetColorTint(resolved, color.tint) : undefined;
}

/** Return the workbook theme slot whose effective color matches an ARGB value. */
export function spreadsheetThemeIndexForColor(value: unknown, themeXml?: unknown): number | undefined {
  const color = normalizeSpreadsheetFontColor(value);
  if (!color) return undefined;
  for (const [index, themedColor] of spreadsheetThemePalette(themeXml)) {
    if (themedColor === color) return index;
  }
  return undefined;
}

function finiteInteger(value: unknown): number | undefined {
  return typeof value === "number" && Number.isInteger(value) && value >= 0 ? value : undefined;
}

function applySpreadsheetColorTint(argb: string, value: unknown): string {
  const tint = typeof value === "number" && Number.isFinite(value)
    ? Math.max(-1, Math.min(1, value))
    : 0;
  if (tint === 0) return argb;
  const alpha = argb.slice(0, 2);
  const channels = [argb.slice(2, 4), argb.slice(4, 6), argb.slice(6, 8)].map((hex) => Number.parseInt(hex, 16));
  const tinted = channels.map((channel) => Math.round(tint < 0
    ? channel * (1 + tint)
    : channel * (1 - tint) + 255 * tint));
  return `${alpha}${tinted.map((channel) => channel.toString(16).padStart(2, "0")).join("")}`.toUpperCase();
}

/** Convert spreadsheet AARRGGBB to CSS #RRGGBB or #RRGGBBAA. */
export function spreadsheetFontColorToCss(value: unknown): string | undefined {
  const argb = normalizeSpreadsheetFontColor(value);
  if (!argb) return undefined;
  const alpha = argb.slice(0, 2);
  const rgb = argb.slice(2);
  return alpha === "FF" ? `#${rgb}` : `#${rgb}${alpha}`;
}
