// 80mm thermal formatter. Both EPSON TM-T82 and TVSE RP3200 Lite
// print 42 columns on 80mm roll in normal font. Same output works on both
// because both speak ESC/POS and share the Windows spooler with PetPooja.

export const COLS = 42;

export const line = (ch = "-") => ch.repeat(COLS);

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

export const formatDateTime = (iso?: string | null) => {
  if (!iso) return new Date().toLocaleString("en-IN", { day: "2-digit", month: "2-digit", year: "2-digit", hour: "2-digit", minute: "2-digit", hour12: false });
  const d = new Date(iso.replace(" ", "T"));
  if (isNaN(d.getTime())) return String(iso);
  return d.toLocaleString("en-IN", { day: "2-digit", month: "2-digit", year: "2-digit", hour: "2-digit", minute: "2-digit", hour12: false });
};
