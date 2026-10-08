import type { CohortRow, CustomerStats, SegmentKey } from "../../utils/analytics/customers";
import { dayLabel, inr, pctText } from "../../utils/analytics/format";
import { SEQ_SCOPE, SERIES, seqFill } from "./colors";
import { SplitBar } from "./ui";

const SEGMENTS: { key: SegmentKey; label: string; rule: string; action: string }[] = [
  { key: "champions", label: "Champions", rule: "3+ orders, active in 30 days", action: "Reward them" },
  { key: "repeat", label: "Repeat", rule: "2 orders, active in 30 days", action: "Nudge a 3rd order" },
  { key: "new", label: "New", rule: "1 order in the last 30 days", action: "Win the 2nd order" },
  { key: "atRisk", label: "At risk", rule: "Last order 31–60 days ago", action: "Send an offer" },
  { key: "lapsed", label: "Lapsed", rule: "No order for 60+ days", action: "Try to win back" },
];

const label = "mb-2 text-[10px] font-bold uppercase tracking-wider text-slate-500 dark:text-zinc-400";

const Mini = ({ title, value }: { title: string; value: string }) => (
  <div className="rounded-xl bg-slate-50 dark:bg-zinc-800/60 p-3">
    <p className="text-[10px] font-bold uppercase tracking-wider text-slate-500 dark:text-zinc-400">{title}</p>
    <p className="mt-0.5 text-lg font-black text-slate-900 dark:text-zinc-100">{value}</p>
  </div>
);

export const CustomersPanel = ({ customers, cohorts }: { customers: CustomerStats; cohorts: CohortRow[] }) => {
  const months = Math.min(5, Math.max(0, ...cohorts.map((c) => c.retained.length)));
  return (
    <div className="space-y-5">
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        <Mini title="Customers" value={String(customers.unique)} />
        <Mini title="New" value={String(customers.newCount)} />
        <Mini title="Returning" value={String(customers.returningCount)} />
        <Mini title="Repeat rate" value={pctText(customers.repeatRate)} />
      </div>

      <div>
        <p className={label}>Sales by customer type</p>
        <SplitBar
          ariaLabel="Sales from returning versus new customers"
          segments={[
            { label: "Returning customers", value: customers.returningSales, color: SERIES[0], display: inr(customers.returningSales) },
            { label: "New customers", value: customers.newSales, color: SERIES[1], display: inr(customers.newSales) },
          ]}
        />
      </div>

      <div>
        <p className={label}>Customer segments (as of period end)</p>
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-5">
          {SEGMENTS.map((s) => (
            <div key={s.key} className="rounded-xl border border-slate-200 dark:border-zinc-800 p-2.5">
              <p className="text-lg font-black text-slate-900 dark:text-zinc-100">{customers.segments[s.key]}</p>
              <p className="text-xs font-semibold text-slate-700 dark:text-zinc-200">{s.label}</p>
              <p className="text-[10px] text-slate-400 dark:text-zinc-500">{s.rule}</p>
              <p className="mt-1 text-[10px] font-semibold text-[#1e40af] dark:text-blue-400">{s.action}</p>
            </div>
          ))}
        </div>
      </div>

      {customers.top.length > 0 && (
        <div>
          <p className={label}>Top customers</p>
          <div className="-mx-4 overflow-x-auto px-4 lg:mx-0 lg:px-0">
            <table className="w-full text-xs">
              <thead>
                <tr className="text-left text-[10px] uppercase tracking-wider text-slate-500 dark:text-zinc-400">
                  <th className="py-2 pr-3 font-bold">Customer</th>
                  <th className="hidden py-2 pr-3 font-bold sm:table-cell">Phone</th>
                  <th className="py-2 pr-3 text-right font-bold">Orders</th>
                  <th className="py-2 pr-3 text-right font-bold">Spend</th>
                  <th className="hidden py-2 font-bold sm:table-cell">Last order</th>
                </tr>
              </thead>
              <tbody>
                {customers.top.map((c) => (
                  <tr key={c.key} className="border-t border-slate-100 dark:border-zinc-800">
                    <td className="max-w-[160px] truncate py-2 pr-3 font-semibold text-slate-800 dark:text-zinc-100">
                      {c.name || "Customer"}
                      {c.isNew && (
                        <span className="ml-2 rounded-full bg-[#2a78d6]/10 px-1.5 py-0.5 text-[9px] font-bold text-[#2a78d6] dark:text-[#3987e5]">
                          NEW
                        </span>
                      )}
                    </td>
                    <td className="hidden py-2 pr-3 tabular-nums text-slate-500 dark:text-zinc-400 sm:table-cell">
                      {c.phoneTail ? `•••• ${c.phoneTail}` : "—"}
                    </td>
                    <td className="py-2 pr-3 text-right tabular-nums text-slate-600 dark:text-zinc-300">{c.orders}</td>
                    <td className="py-2 pr-3 text-right font-semibold tabular-nums text-slate-900 dark:text-zinc-100">{inr(c.spend)}</td>
                    <td className="hidden py-2 text-slate-500 dark:text-zinc-400 sm:table-cell">{dayLabel(c.lastOrder)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {cohorts.length > 0 && (
        <div className={SEQ_SCOPE}>
          <p className={label}>Retention by first-order month</p>
          <p className="-mt-1 mb-2 text-[11px] text-slate-400 dark:text-zinc-500">
            Share of each month's new customers who ordered again 1, 2, 3… months later.
          </p>
          <div className="-mx-4 overflow-x-auto px-4 lg:mx-0 lg:px-0">
            <table className="w-full text-xs">
              <thead>
                <tr className="text-left text-[10px] uppercase tracking-wider text-slate-500 dark:text-zinc-400">
                  <th className="py-2 pr-3 font-bold">First order</th>
                  <th className="py-2 pr-3 text-right font-bold">Customers</th>
                  {Array.from({ length: months }, (_, k) => (
                    <th key={k} className="py-2 px-1 text-center font-bold">
                      +{k + 1} mo
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {cohorts.map((c) => (
                  <tr key={c.month} className="border-t border-slate-100 dark:border-zinc-800">
                    <td className="py-1.5 pr-3 whitespace-nowrap font-semibold text-slate-800 dark:text-zinc-100">{c.label}</td>
                    <td className="py-1.5 pr-3 text-right tabular-nums text-slate-600 dark:text-zinc-300">{c.size}</td>
                    {Array.from({ length: months }, (_, k) => {
                      const v = c.retained[k];
                      return (
                        <td key={k} className="px-1 py-1.5">
                          {v === undefined ? (
                            <span className="block text-center text-slate-300 dark:text-zinc-700">·</span>
                          ) : (
                            <span
                              className={`block rounded-md py-1 text-center tabular-nums font-semibold ${
                                v >= 0.5 ? "text-white" : "text-slate-800 dark:text-zinc-100"
                              }`}
                              style={seqFill(Math.max(0.08, v))}
                            >
                              {pctText(v)}
                            </span>
                          )}
                        </td>
                      );
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
};
