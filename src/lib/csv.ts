// CSV with RFC 4180 quoting and spreadsheet-formula protection: a cell that
// starts with = + - @ (or tab/CR) is prefixed with ' so Excel/Sheets show it
// as text instead of running it.

type Cell = string | number | boolean | Date | null | undefined;

export function csvCell(value: Cell): string {
  if (value == null) return "";
  let s = value instanceof Date ? value.toISOString() : String(value);
  if (typeof value === "string" && /^[=+\-@\t\r]/.test(s)) s = `'${s}`;
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export function toCsv<T>(rows: T[], columns: [header: string, get: (row: T) => Cell][]): string {
  const lines = [columns.map(([h]) => csvCell(h)).join(","), ...rows.map((r) => columns.map(([, get]) => csvCell(get(r))).join(","))];
  return "﻿" + lines.join("\r\n") + "\r\n"; // BOM so Excel reads UTF-8
}

export function csvResponse(csv: string, filename: string) {
  return new Response(csv, {
    headers: {
      "content-type": "text/csv; charset=utf-8",
      "content-disposition": `attachment; filename="${filename.replace(/[^\w.-]/g, "_")}"`,
      "cache-control": "no-store",
    },
  });
}
