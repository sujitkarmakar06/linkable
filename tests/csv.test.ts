import { describe, expect, it } from "vitest";
import { csvCell, toCsv } from "@/lib/csv";

describe("csv", () => {
  it("quotes commas, quotes and newlines", () => {
    expect(csvCell('a,"b"\nc')).toBe('"a,""b""\nc"');
    expect(csvCell(null)).toBe("");
    expect(csvCell(3)).toBe("3");
  });
  it("neutralises spreadsheet formulas in text", () => {
    expect(csvCell("=HYPERLINK(\"http://evil\")")).toBe("\"'=HYPERLINK(\"\"http://evil\"\")\"");
    expect(csvCell("@SUM(A1)")).toBe("'@SUM(A1)");
    expect(csvCell("-2+3")).toBe("'-2+3");
    expect(csvCell(-2)).toBe("-2"); // real numbers stay numbers
  });
  it("builds a CSV with BOM and CRLF", () => {
    expect(toCsv([{ a: 1, b: "x" }], [["A", (r) => r.a], ["B", (r) => r.b]])).toBe("﻿A,B\r\n1,x\r\n");
  });
});
