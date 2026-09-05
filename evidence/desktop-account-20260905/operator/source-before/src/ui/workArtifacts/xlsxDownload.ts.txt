import type { Workbook } from "exceljs";

export interface XlsxDownloadReceipt {
  fileName: string;
  rowCount: number;
  sheetCount: number;
  byteCount: number;
  at: string;
}

/** Serialize the existing workbook and start a browser download; disk saving belongs to the browser. */
export async function downloadXlsxWorkbook(
  workbook: Workbook,
  fileName: string,
  rowCount: number,
  signal?: AbortSignal,
): Promise<XlsxDownloadReceipt> {
  signal?.throwIfAborted();
  const buffer = await workbook.xlsx.writeBuffer();
  // Serialization itself is not cancellable. An obsolete caller must not dispatch its later result.
  signal?.throwIfAborted();
  const blob = new Blob([buffer as ArrayBuffer], {
    type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = fileName;
  anchor.style.display = "none";
  try {
    document.body.appendChild(anchor);
    anchor.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true, view: window }));
  } finally {
    anchor.remove();
    // Retain the existing desktop negotiation window, including on a failed dispatch.
    setTimeout(() => URL.revokeObjectURL(url), 60_000);
  }
  return {
    fileName,
    rowCount,
    sheetCount: workbook.worksheets.length,
    byteCount: buffer.byteLength,
    at: new Date().toLocaleTimeString([], { hour: "numeric", minute: "2-digit" }),
  };
}
