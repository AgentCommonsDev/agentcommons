/**
 * Minimal RFC 4180 reader for exported files: quoted fields, doubled quotes, CRLF or LF
 * line ends. The first record holds the column names.
 */
export function parseCsv(text: string): {
  fields: string[];
  rows: Record<string, string>[];
} {
  const records: string[][] = [];
  let record: string[] = [];
  let field = "";
  let quoted = false;
  for (let index = 0; index < text.length; index++) {
    const character = text.charAt(index);
    if (quoted) {
      if (character === '"') {
        if (text[index + 1] === '"') {
          field += '"';
          index++;
        } else quoted = false;
      } else field += character;
      continue;
    }
    if (character === '"') quoted = true;
    else if (character === ",") {
      record.push(field);
      field = "";
    } else if (character === "\n" || character === "\r") {
      if (character === "\r" && text[index + 1] === "\n") index++;
      record.push(field);
      records.push(record);
      record = [];
      field = "";
    } else field += character;
  }
  if (field !== "" || record.length > 0) {
    record.push(field);
    records.push(record);
  }
  const [fields = [], ...rest] = records;
  return {
    fields,
    rows: rest
      .filter((entry) => entry.length > 1 || entry[0] !== "")
      .map((entry) =>
        Object.fromEntries(fields.map((name, at) => [name, entry[at] ?? ""])),
      ),
  };
}
