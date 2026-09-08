import { formatCsvTable } from "@agentcommons/core/format/csv";
export function csvBlob(fields: string[], rows: unknown[][]): Blob {
  return new Blob([formatCsvTable(fields, rows)], {
    type: "text/csv;charset=utf-8",
  });
}
export function downloadBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
  URL.revokeObjectURL(url);
}
