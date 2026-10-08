// Chart colours from the validated data-viz palette (colour-blind-safe order, separate
// light and dark steps). Identity hues are used in this fixed order, never by rank.
export const SERIES = [
  "bg-[#2a78d6] dark:bg-[#3987e5]",
  "bg-[#eb6834] dark:bg-[#d95926]",
  "bg-[#1baf7a] dark:bg-[#199e70]",
  "bg-[#eda100] dark:bg-[#c98500]",
] as const;

// Status colours only ever mean a state, and always sit next to a text label.
export const STATUS_BG = {
  good: "bg-[#0ca30c]",
  critical: "bg-[#d03b3b]",
  serious: "bg-[#ec835a]",
  neutral: "bg-slate-300 dark:bg-zinc-600",
} as const;

export const GOOD_TEXT = "text-[#006300] dark:text-[#0ca30c]";
export const BAD_TEXT = "text-[#d03b3b] dark:text-[#e66767]";

// Sequential (more = darker) fills use the series-1 blue at rising opacity, so the
// same scale reads correctly on the light and the dark surface.
export const SEQ_SCOPE = "[--qv-seq:42_120_214] dark:[--qv-seq:57_135_229]";
export const seqFill = (alpha: number) => ({ backgroundColor: `rgb(var(--qv-seq) / ${alpha})` });

export const AXIS_TEXT = "text-[#898781]";
export const GRID_LINE = "border-[#e1e0d9] dark:border-[#2c2c2a]";
