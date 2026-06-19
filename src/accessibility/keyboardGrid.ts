export type GridNavigationKey = "ArrowUp" | "ArrowDown" | "ArrowLeft" | "ArrowRight" | "Home" | "End";

export type GridPosition = {
  row: number;
  column: number;
};

export type GridNavigationInput = {
  key: GridNavigationKey;
  index: number;
  rowCount: number;
  columnCount: number;
  wrapRows?: boolean;
};

export function rowColumnFromIndex(index: number, columnCount: number): GridPosition {
  const safeColumnCount = Math.max(1, Math.floor(columnCount));
  const safeIndex = Math.max(0, Math.floor(index));
  return {
    row: Math.floor(safeIndex / safeColumnCount),
    column: safeIndex % safeColumnCount,
  };
}

export function indexFromRowColumn(position: GridPosition, columnCount: number): number {
  const safeColumnCount = Math.max(1, Math.floor(columnCount));
  return Math.max(0, Math.floor(position.row)) * safeColumnCount + Math.max(0, Math.floor(position.column));
}

export function nextGridIndex(input: GridNavigationInput): number {
  const rowCount = Math.max(1, Math.floor(input.rowCount));
  const columnCount = Math.max(1, Math.floor(input.columnCount));
  const maxIndex = rowCount * columnCount - 1;
  const current = Math.min(Math.max(0, Math.floor(input.index)), maxIndex);
  const position = rowColumnFromIndex(current, columnCount);

  if (input.key === "Home") return indexFromRowColumn({ row: position.row, column: 0 }, columnCount);
  if (input.key === "End") return indexFromRowColumn({ row: position.row, column: columnCount - 1 }, columnCount);
  if (input.key === "ArrowUp") return Math.max(0, current - columnCount);
  if (input.key === "ArrowDown") return Math.min(maxIndex, current + columnCount);
  if (input.key === "ArrowLeft") {
    if (position.column > 0) return current - 1;
    return input.wrapRows && position.row > 0 ? current - 1 : current;
  }
  if (position.column < columnCount - 1) return current + 1;
  return input.wrapRows && position.row < rowCount - 1 ? current + 1 : current;
}
