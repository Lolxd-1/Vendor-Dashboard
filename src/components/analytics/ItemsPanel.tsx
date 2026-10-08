import { useState } from "react";
import type { ItemPair, ItemRow } from "../../utils/analytics/items";
import { inr, pctText } from "../../utils/analytics/format";
import { SERIES } from "./colors";
import { EmptyNote } from "./ui";

const pill = "px-2.5 py-1 rounded-full text-[11px] font-semibold border transition-colors";
const pillOn = "bg-[#1e40af] text-white border-[#1e40af] dark:bg-zinc-100 dark:text-zinc-900 dark:border-zinc-100";
const pillOff = "text-slate-500 border-slate-200 dark:text-zinc-400 dark:border-zinc-700";

export const ItemsPanel = ({ items, pairs }: { items: ItemRow[]; pairs: ItemPair[] }) => {
  const [byUnits, setByUnits] = useState(false);
  const [showAll, setShowAll] = useState(false);
  if (items.length === 0) return <EmptyNote text="No items sold in this period." />;

  const sorted = byUnits ? [...items].sort((a, b) => b.units - a.units || b.revenue - a.revenue) : items;
  const rows = showAll ? sorted : sorted.slice(0, 10);
  const topShare = Math.max(...items.map((i) => i.share));

  return (
    <div>
      <div className="mb-3 flex gap-2">
        <button type="button" className={`${pill} ${byUnits ? pillOff : pillOn}`} onClick={() => setByUnits(false)}>
          By sales
        </button>
        <button type="button" className={`${pill} ${byUnits ? pillOn : pillOff}`} onClick={() => setByUnits(true)}>
          By units
        </button>
      </div>

      <div className="-mx-4 overflow-x-auto px-4 lg:mx-0 lg:px-0">
        <table className="w-full text-xs">
          <thead>
            <tr className="text-left text-[10px] uppercase tracking-wider text-slate-500 dark:text-zinc-400">
              <th className="py-2 pr-2 font-bold">#</th>
              <th className="py-2 pr-3 font-bold">Item</th>
              <th className="py-2 pr-3 text-right font-bold">Units</th>
              <th className="hidden py-2 pr-3 text-right font-bold sm:table-cell">Orders</th>
              <th className="py-2 pr-3 text-right font-bold">Sales</th>
              <th className="py-2 font-bold">Share</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((it, i) => (
              <tr key={it.name} className="border-t border-slate-100 dark:border-zinc-800">
                <td className="py-2 pr-2 text-slate-400 dark:text-zinc-500 tabular-nums">{i + 1}</td>
                <td className="max-w-[180px] truncate py-2 pr-3 font-semibold text-slate-800 dark:text-zinc-100" title={it.name}>
                  {it.name}
                </td>
                <td className="py-2 pr-3 text-right tabular-nums text-slate-600 dark:text-zinc-300">{it.units}</td>
                <td className="hidden py-2 pr-3 text-right tabular-nums text-slate-600 dark:text-zinc-300 sm:table-cell">
                  {it.orders}
                </td>
                <td
                  className="py-2 pr-3 text-right font-semibold tabular-nums text-slate-900 dark:text-zinc-100 whitespace-nowrap"
                  title={it.estimated ? "Estimated: some orders came without item prices" : undefined}
                >
                  {it.estimated ? "≈" : ""}
                  {inr(it.revenue)}
                </td>
                <td className="py-2">
                  <div className="flex items-center gap-2">
                    <div className="h-1.5 w-14 rounded-full bg-slate-100 dark:bg-zinc-800">
                      <div
                        className={`h-1.5 rounded-full ${SERIES[0]}`}
                        style={{ width: `${topShare > 0 ? (it.share / topShare) * 100 : 0}%` }}
                      />
                    </div>
                    <span className="tabular-nums text-slate-500 dark:text-zinc-400">{pctText(it.share)}</span>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {items.length > 10 && (
        <button
          type="button"
          onClick={() => setShowAll((v) => !v)}
          className="mt-2 text-xs font-semibold text-[#1e40af] dark:text-blue-400 hover:underline"
        >
          {showAll ? "Show top 10" : `Show all ${items.length} items`}
        </button>
      )}
      {items.some((i) => i.estimated) && (
        <p className="mt-2 text-[11px] text-slate-400 dark:text-zinc-500">
          ≈ Estimated: some orders came without item prices, so their total was split by each item's usual price.
        </p>
      )}

      {pairs.length > 0 && (
        <div className="mt-4 border-t border-slate-100 dark:border-zinc-800 pt-3">
          <p className="mb-2 text-[10px] font-bold uppercase tracking-wider text-slate-500 dark:text-zinc-400">
            Frequently bought together
          </p>
          <ul className="space-y-1.5">
            {pairs.map((p) => (
              <li key={`${p.a}|${p.b}`} className="flex items-center justify-between gap-3 text-xs">
                <span className="min-w-0 truncate text-slate-700 dark:text-zinc-200">
                  {p.a} <span className="text-slate-400">+</span> {p.b}
                </span>
                <span className="shrink-0 tabular-nums text-slate-500 dark:text-zinc-400">{p.orders} orders</span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
};
