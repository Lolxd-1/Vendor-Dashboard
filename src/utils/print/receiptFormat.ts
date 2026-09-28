// 80mm thermal formatter. Both EPSON TM-T82 and TVSE RP3200 Lite print
// through the Windows spooler (shared with PetPooja). 36 columns, like
// PetPooja's slip: the print agent sizes its font to fit them, so fewer
// columns = bigger, darker letters.

export const COLS = 36;

export const line = (ch = "-") => ch.repeat(COLS);

// Heading marker: a line starting with char 14 (ESC/POS "SO", double width) is
// printed double size and centred by the print agent / browser fallback.
export const BIG = "\u000E";
// Pre-centred, so an agent that predates the marker still prints it centred.
export const big = (text: string) => BIG + center(text);

export const center = (text: string) => {
  const t = text.length >= COLS ? text.slice(0, COLS) : text;
  const pad = Math.floor((COLS - t.length) / 2);
  return " ".repeat(Math.max(0, pad)) + t;
};

export const row = (left: string, right: string) => {
  const l = left ?? "";
  const r = right ?? "";
  const space = COLS - l.length - r.length;
  if (space < 1) return (l + " " + r).slice(0, COLS);
  return l + " ".repeat(space) + r;
};

// Wrap long item names to 2 lines without breaking the table.
export const wrap = (text: string, width: number): string[] => {
  const words = (text || "").split(" ");
  const lines: string[] = [];
  let cur = "";
  for (const w of words) {
    if ((cur + " " + w).trim().length > width) {
      if (cur) lines.push(cur.trim());
      cur = w;
    } else {
      cur = cur + " " + w;
    }
  }
  if (cur.trim()) lines.push(cur.trim());
  return lines.length ? lines : [""];
};

export const money = (n: number | undefined | null) => {
  if (n === undefined || n === null || isNaN(Number(n))) return "--";
  return Number(n).toFixed(2);
};

// 12-hour clock, e.g. "13/09/26, 8:57 PM".
const DATE_OPTS: Intl.DateTimeFormatOptions = { day: "2-digit", month: "2-digit", year: "2-digit", hour: "numeric", minute: "2-digit", hour12: true };
const fmt12 = (d: Date) => d.toLocaleString("en-IN", DATE_OPTS).replace(/\s*(am|pm)$/i, (m) => " " + m.trim().toUpperCase());

export const formatDateTime = (iso?: string | null) => {
  if (!iso) return fmt12(new Date());
  const d = new Date(iso.replace(" ", "T"));
  if (isNaN(d.getTime())) return String(iso);
  return fmt12(d);
};
