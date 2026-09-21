import { CsvColumn, toCsv } from "./csv.util";

interface Row {
  name: string;
  qty: number;
  code: string | null;
}

const COLUMNS: CsvColumn<Row>[] = [
  { header: "name", value: (row) => row.name },
  { header: "qty", value: (row) => row.qty },
  { header: "code", value: (row) => row.code, literal: true },
];

/** Written out as an escape on purpose — a literal BOM in source is invisible. */
const BOM = "\uFEFF";

/** Drop the BOM + trailing CRLF so assertions read on the data alone. */
function bodyLines(csv: string): string[] {
  const withoutBom = csv.startsWith(BOM) ? csv.slice(BOM.length) : csv;
  return withoutBom.trimEnd().split("\r\n");
}

describe("toCsv", () => {
  it("starts with a UTF-8 BOM so Excel VN does not mangle diacritics", () => {
    const csv = toCsv([{ name: "Áo thun", qty: 1, code: null }], COLUMNS);
    expect(csv.charCodeAt(0)).toBe(0xfeff);
    expect(csv).toContain("Áo thun");
  });

  it("writes the header row first and uses CRLF line endings", () => {
    const csv = toCsv([{ name: "a", qty: 1, code: null }], COLUMNS);
    expect(csv).toBe("\uFEFFname,qty,code\r\na,1,\r\n");
  });

  it("renders headers only when there are no rows", () => {
    expect(bodyLines(toCsv([], COLUMNS))).toEqual(["name,qty,code"]);
  });

  describe("escaping", () => {
    it("quotes a value containing a comma", () => {
      const csv = toCsv([{ name: "Đen, size L", qty: 2, code: null }], COLUMNS);
      expect(bodyLines(csv)[1]).toBe('"Đen, size L",2,');
    });

    it("doubles inner quotes", () => {
      const csv = toCsv(
        [{ name: 'Áo "limited"', qty: 1, code: null }],
        COLUMNS,
      );
      expect(bodyLines(csv)[1]).toBe('"Áo ""limited""",1,');
    });

    it("quotes a value containing a newline", () => {
      const csv = toCsv(
        [{ name: "line1\nline2", qty: 1, code: null }],
        COLUMNS,
      );
      expect(csv).toContain('"line1\nline2"');
    });

    it("renders null and undefined as an empty cell", () => {
      const columns: CsvColumn<Row>[] = [
        { header: "a", value: () => null },
        { header: "b", value: () => undefined },
      ];
      expect(
        bodyLines(toCsv([{ name: "x", qty: 0, code: null }], columns))[1],
      ).toBe(",");
    });
  });

  describe("CSV injection", () => {
    it.each(["=1+1", "+1", "@SUM(A1)", "\tcmd", "\rcmd"])(
      "prefixes %j with an apostrophe",
      (dangerous) => {
        const csv = toCsv([{ name: dangerous, qty: 1, code: null }], COLUMNS);
        // The guard sits on the VALUE. A `\r`/`\t` payload is additionally
        // wrapped in quotes by the escaping rule, so assert on the pair rather
        // than on position 0 of the rendered cell.
        expect(csv).toContain(`'${dangerous}`);
      },
    );

    it("neutralises the classic =cmd payload in a seller-supplied name", () => {
      const payload = "=cmd|' /C calc'!A0";
      const csv = toCsv([{ name: payload, qty: 1, code: null }], COLUMNS);
      // Quoted because of the inner quotes/pipe payload, but the leading `=`
      // is no longer the first character of the cell value.
      expect(bodyLines(csv)[1]).toContain("'=cmd");
    });

    it("leaves a plain negative number summable instead of guarding it", () => {
      const columns: CsvColumn<Row>[] = [
        { header: "amount", value: (row) => row.qty },
      ];
      const csv = toCsv([{ name: "x", qty: -500, code: null }], columns);
      expect(bodyLines(csv)[1]).toBe("-500");
    });

    it("still guards a minus-led value that is not a number", () => {
      const columns: CsvColumn<Row>[] = [
        { header: "amount", value: () => "-1+1+cmd" },
      ];
      const csv = toCsv([{ name: "x", qty: 0, code: null }], columns);
      expect(bodyLines(csv)[1]).toBe("'-1+1+cmd");
    });
  });

  describe("literal columns", () => {
    it('wraps the value as ="…" so Excel keeps the digits', () => {
      const csv = toCsv([{ name: "a", qty: 1, code: "123456789012" }], COLUMNS);
      expect(bodyLines(csv)[1]).toBe('a,1,="123456789012"');
    });

    it("keeps a leading zero on a phone number", () => {
      const csv = toCsv([{ name: "a", qty: 1, code: "0901234567" }], COLUMNS);
      expect(bodyLines(csv)[1]).toContain('="0901234567"');
    });

    it("strips quotes and commas rather than escaping them", () => {
      const csv = toCsv([{ name: "a", qty: 1, code: 'GH"N,12' }], COLUMNS);
      expect(bodyLines(csv)[1]).toBe('a,1,="GH N 12"');
    });

    it('renders an empty literal as a blank cell, not =""', () => {
      const csv = toCsv([{ name: "a", qty: 1, code: "" }], COLUMNS);
      expect(bodyLines(csv)[1]).toBe("a,1,");
    });
  });
});
