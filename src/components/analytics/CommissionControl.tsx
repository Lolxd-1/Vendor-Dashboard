import { useState } from "react";
import { Percent } from "lucide-react";
import { isValidCommissionPct } from "../../utils/analytics/commission";

const QUICK = [5, 10];

const chip =
  "flex items-center gap-1.5 whitespace-nowrap px-3 py-1.5 rounded-full bg-slate-100 dark:bg-zinc-800 border border-slate-200 dark:border-zinc-700 text-slate-600 dark:text-zinc-300 text-xs font-semibold hover:bg-[#1e40af]/10 hover:border-[#1e40af]/30 hover:text-[#1e40af] dark:hover:bg-blue-500/10 dark:hover:text-blue-400 transition-all duration-200 active:scale-95";

// QuickVerse commission for this shop. Display only: it changes the page and the PDF,
// never a real payout.
export const CommissionControl = ({ pct, onChange }: { pct: number; onChange: (pct: number) => void }) => {
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState("");
  const [error, setError] = useState<string | null>(null);

  const apply = (value: number) => {
    if (!isValidCommissionPct(value)) {
      setError("Enter a number from 0 to 100.");
      return;
    }
    onChange(value);
    setOpen(false);
  };

  return (
    <div className="relative">
      <button
        type="button"
        aria-expanded={open}
        className={chip}
        onClick={() => {
          setDraft(String(pct));
          setError(null);
          setOpen((o) => !o);
        }}
      >
        <Percent size={13} />
        Commission {pct}%
      </button>

      {open && (
        <>
          <button type="button" aria-label="Close" className="fixed inset-0 z-10 cursor-default" onClick={() => setOpen(false)} />
          <div className="absolute right-0 z-20 mt-2 w-64 rounded-xl border border-slate-200 dark:border-zinc-700 bg-white dark:bg-zinc-900 p-3 shadow-xl">
            <p className="text-xs font-bold text-slate-900 dark:text-zinc-100">QuickVerse commission</p>
            <p className="mt-0.5 text-[11px] text-slate-500 dark:text-zinc-400">
              Used on this page and in the PDF. Saved on this device for this shop.
            </p>
            <div className="mt-3 flex gap-2">
              {QUICK.map((v) => (
                <button
                  key={v}
                  type="button"
                  onClick={() => apply(v)}
                  className={`flex-1 rounded-lg border px-2 py-1.5 text-xs font-bold ${
                    pct === v
                      ? "border-[#1e40af] bg-[#1e40af] text-white dark:border-zinc-100 dark:bg-zinc-100 dark:text-zinc-900"
                      : "border-slate-200 text-slate-600 dark:border-zinc-700 dark:text-zinc-300"
                  }`}
                >
                  {v}%
                </button>
              ))}
            </div>
            {/* noValidate: our message, not the browser's bubble (which also rejects 7.25 as "off-step") */}
            <form
              noValidate
              className="mt-2 flex gap-2"
              onSubmit={(e) => {
                e.preventDefault();
                apply(draft.trim() === "" ? NaN : Number(draft));
              }}
            >
              <input
                type="number"
                inputMode="decimal"
                step="any"
                min={0}
                max={100}
                value={draft}
                onChange={(e) => setDraft(e.target.value)}
                aria-label="Custom commission percent"
                className="w-full rounded-lg border border-slate-300 dark:border-zinc-700 bg-white dark:bg-zinc-800 px-2 py-1.5 text-xs text-slate-700 dark:text-zinc-200 outline-none focus:border-[#1e40af]"
              />
              <button type="submit" className="rounded-lg bg-[#1e40af] px-3 py-1.5 text-xs font-bold text-white dark:bg-zinc-100 dark:text-zinc-900">
                Save
              </button>
            </form>
            {error && (
              <p role="alert" className="mt-2 text-[11px] text-[#d03b3b] dark:text-[#e66767]">
                {error}
              </p>
            )}
          </div>
        </>
      )}
    </div>
  );
};
