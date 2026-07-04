/**
 * CommandPalette — the ⌘K keyboard layer (design: Scale systems — "⌘K palette ·
 * j/k/↵ / / w/f/g-t · focus rings survive calm mode"). Hand-rolled, no palette
 * deps: a window Ctrl/Cmd+K listener, a substring filter over room artifacts +
 * core shell actions, arrow/j-k navigation, Enter to run, Esc to close with
 * focus restored to wherever the keyboard came from.
 *
 * Contracts:
 * - Opening is IGNORED while the user is typing (input/textarea/contenteditable)
 *   so ⌘K never eats a keystroke mid-sentence; ⌘K while the palette is open
 *   toggles it closed (the palette's own input doesn't block that).
 * - BOUND: at most COMMAND_PALETTE_MAX_ITEMS options render; the rest collapse
 *   into a "+N more" line (an agent seeding 5k artifacts can't flood the DOM).
 * - aria-combobox semantics: the input owns aria-activedescendant, the list is
 *   a listbox, options carry aria-selected. Focus is trapped in the input
 *   (Tab is a no-op; arrows are the navigation).
 * - Terracotta = selection (accent tint/border on the active row); the visible
 *   --focus-ring halo marks keyboard focus, calm mode or not.
 */

import { useEffect, useMemo, useRef, useState, type KeyboardEvent as ReactKeyboardEvent } from "react";
import { Search, CornerDownLeft } from "lucide-react";
import { useStore } from "../app/store";
import { textEntryIsActive } from "./focusMode";
import "./command-palette.css";

/** Render bound: 12 rows on screen, "+N more" for the rest — keep typing to narrow. */
export const COMMAND_PALETTE_MAX_ITEMS = 12;

export type PaletteAction = {
  id: string;
  label: string;
  /** Small right-aligned hint (e.g. "host", "/", artifact kind). */
  hint?: string;
  run: () => void;
};

type PaletteEntry = { id: string; label: string; hint?: string; kind: "action" | "artifact"; artifactId?: string; run?: () => void };

/**
 * Fuzzy-ish filter: every whitespace-separated token must appear as a
 * case-insensitive substring; results rank by earliest first-token position
 * (prefix matches first), stable otherwise. Plain indexOf — hostile queries
 * ("(((", regex metachars) are just text.
 */
export function filterPaletteEntries<T extends { label: string }>(entries: T[], query: string): T[] {
  const tokens = query.trim().toLowerCase().split(/\s+/).filter(Boolean);
  if (tokens.length === 0) return entries;
  const scored: Array<{ entry: T; score: number; tie: number }> = [];
  entries.forEach((entry, tie) => {
    const label = entry.label.toLowerCase();
    if (!tokens.every((t) => label.includes(t))) return;
    scored.push({ entry, score: label.indexOf(tokens[0]), tie });
  });
  scored.sort((a, b) => a.score - b.score || a.tie - b.tie);
  return scored.map((s) => s.entry);
}

export function CommandPalette({
  roomId,
  actions,
  onOpenArtifact,
}: {
  roomId: string;
  actions: PaletteAction[];
  onOpenArtifact: (artifactId: string) => void;
}) {
  const store = useStore();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [cursor, setCursor] = useState(0);
  const openRef = useRef(open);
  openRef.current = open;
  const inputRef = useRef<HTMLInputElement>(null);
  /** Where keyboard focus was when ⌘K fired — Esc puts the user back there. */
  const prevFocusRef = useRef<HTMLElement | null>(null);

  const closePalette = (restoreFocus: boolean) => {
    setOpen(false);
    setQuery("");
    setCursor(0);
    if (restoreFocus) {
      const prev = prevFocusRef.current;
      if (prev && prev.isConnected) prev.focus();
    }
    prevFocusRef.current = null;
  };
  const closeRef = useRef(closePalette);
  closeRef.current = closePalette;

  // One window listener for the lifetime of the palette; open/close state is
  // read through refs so the listener count stays constant (no re-subscribes,
  // no leak under sustained open/close cycles).
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key.toLowerCase() !== "k" || !(e.metaKey || e.ctrlKey) || e.altKey) return;
      if (openRef.current) {
        e.preventDefault();
        closeRef.current(true);
        return;
      }
      // Never steal ⌘K mid-typing (chat composer, cell editor, notebook).
      if (textEntryIsActive()) return;
      e.preventDefault();
      prevFocusRef.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
      setOpen(true);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  // Focus lands in the filter input the moment the palette opens.
  useEffect(() => {
    if (open) inputRef.current?.focus();
  }, [open]);

  const artifacts = store.listArtifacts(roomId);
  const entries = useMemo<PaletteEntry[]>(() => {
    const actionEntries: PaletteEntry[] = actions.map((a) => ({ id: `action:${a.id}`, label: a.label, hint: a.hint, kind: "action", run: a.run }));
    const artifactEntries: PaletteEntry[] = artifacts.map((a) => ({
      id: `artifact:${a.id}`,
      label: `Open ${a.title}`,
      hint: a.kind,
      kind: "artifact",
      artifactId: a.id,
    }));
    return [...actionEntries, ...artifactEntries];
  }, [actions, artifacts]);

  const matches = useMemo(() => filterPaletteEntries(entries, query), [entries, query]);
  const visible = matches.slice(0, COMMAND_PALETTE_MAX_ITEMS);
  const moreCount = matches.length - visible.length;
  // Derived clamp (never an effect): a narrowing filter can't strand the cursor
  // past the end of the list, and there's no state-sync loop to latch.
  const selected = visible.length === 0 ? -1 : Math.min(cursor, visible.length - 1);

  // Keep the active row in view as j/k walks a longer-than-viewport list.
  useEffect(() => {
    if (!open || selected < 0) return;
    const el = document.getElementById(`r-cmdk-opt-${selected}`);
    if (el && typeof el.scrollIntoView === "function") el.scrollIntoView({ block: "nearest" });
  }, [open, selected, query]);

  if (!open) return null;

  const runEntry = (entry: PaletteEntry | undefined) => {
    if (!entry) return;
    // Close first WITHOUT restoring focus — actions like "Jump to chat composer"
    // place focus themselves and must not be fought.
    setOpen(false);
    setQuery("");
    setCursor(0);
    prevFocusRef.current = null;
    if (entry.kind === "artifact" && entry.artifactId) onOpenArtifact(entry.artifactId);
    else entry.run?.();
  };

  const step = (delta: number) => {
    if (visible.length === 0) return;
    setCursor((selected + delta + visible.length) % visible.length);
  };

  const onKeyDown = (e: ReactKeyboardEvent) => {
    const k = e.key;
    if (k === "Escape") {
      e.preventDefault();
      closePalette(true);
      return;
    }
    if (k === "Enter") {
      e.preventDefault();
      runEntry(visible[selected]);
      return;
    }
    if (k === "ArrowDown") { e.preventDefault(); step(1); return; }
    if (k === "ArrowUp") { e.preventDefault(); step(-1); return; }
    // Vim row-walking: plain j/k while the filter is empty (list mode), or
    // Ctrl+j/k any time. Once a query exists, plain j/k are just letters —
    // substring filtering ("ump" finds "Jump to chat composer") keeps every
    // command reachable.
    if ((k === "j" || k === "k") && (e.ctrlKey || query === "")) {
      e.preventDefault();
      step(k === "j" ? 1 : -1);
      return;
    }
    // Focus trap: arrows are the navigation; Tab never escapes the dialog.
    if (k === "Tab") e.preventDefault();
  };

  return (
    <div
      className="r-cmdk-backdrop"
      role="presentation"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) closePalette(true);
      }}
    >
      <div className="r-cmdk" role="dialog" aria-modal="true" aria-label="Command palette" data-testid="command-palette" onKeyDown={onKeyDown}>
        <div className="r-cmdk-inputwrap">
          <Search size={14} aria-hidden />
          <input
            ref={inputRef}
            className="r-cmdk-input"
            role="combobox"
            aria-expanded="true"
            aria-autocomplete="list"
            aria-controls="r-cmdk-list"
            aria-activedescendant={selected >= 0 ? `r-cmdk-opt-${selected}` : undefined}
            aria-label="Search artifacts and commands"
            placeholder="Search artifacts and commands…"
            data-testid="command-palette-input"
            value={query}
            onChange={(e) => {
              setQuery(e.currentTarget.value);
              setCursor(0);
            }}
          />
          <kbd className="r-cmdk-kbd">esc</kbd>
        </div>
        <div className="r-cmdk-list" role="listbox" id="r-cmdk-list" aria-label="Palette results">
          {visible.map((entry, i) => (
            <button
              key={entry.id}
              type="button"
              role="option"
              id={`r-cmdk-opt-${i}`}
              aria-selected={i === selected}
              className="r-cmdk-item"
              data-selected={String(i === selected)}
              data-kind={entry.kind}
              data-testid="command-palette-item"
              // mousedown would steal focus from the input before click lands.
              onMouseDown={(e) => e.preventDefault()}
              onMouseEnter={() => setCursor(i)}
              onClick={() => runEntry(entry)}
            >
              <span className="r-cmdk-item-label">{entry.label}</span>
              {entry.hint && <span className="r-cmdk-item-hint">{entry.hint}</span>}
            </button>
          ))}
          {moreCount > 0 && (
            <div className="r-cmdk-more" data-testid="command-palette-more">
              +{moreCount} more — keep typing to narrow
            </div>
          )}
          {visible.length === 0 && (
            <div className="r-cmdk-empty" data-testid="command-palette-empty">
              No matches for “{query}”
            </div>
          )}
        </div>
        <div className="r-cmdk-foot" aria-hidden>
          <span><kbd className="r-cmdk-kbd">↑↓</kbd><kbd className="r-cmdk-kbd">j·k</kbd> navigate</span>
          <span><kbd className="r-cmdk-kbd"><CornerDownLeft size={9} /></kbd> run</span>
          <span><kbd className="r-cmdk-kbd">esc</kbd> close</span>
        </div>
      </div>
    </div>
  );
}
