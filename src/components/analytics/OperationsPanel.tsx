import type { AnalyticsReport, PaymentSplit } from "../../utils/analytics/report";
import { inr, paymentLabel } from "../../utils/analytics/format";
import { SERIES, STATUS_BG } from "./colors";
import { SplitBar } from "./ui";

// Each method keeps its colour whatever its rank, so "COD" is always the same blue.
const METHOD_COLORS: Record<string, string> = {
  COD: SERIES[0],
  PREPAID: SERIES[1],
  QR_CODE: SERIES[2],
  ONLINE: SERIES[3],
};

const label = "mb-2 text-[10px] font-bold uppercase tracking-wider text-slate-500 dark:text-zinc-400";

export const OperationsPanel = ({
  kpis,
  payments,
  timing,
}: {
  kpis: AnalyticsReport["kpis"];
  payments: PaymentSplit[];
  timing: AnalyticsReport["timing"];
}) => (
  <div className="space-y-5">
    <div>
      <p className={label}>Order status ({kpis.orders} orders)</p>
      <SplitBar
        ariaLabel="Orders by status"
        segments={[
          { label: "Completed", value: kpis.completed, color: STATUS_BG.good },
          { label: "Cancelled", value: kpis.cancelled, color: STATUS_BG.critical },
          { label: "Rejected", value: kpis.rejected, color: STATUS_BG.serious },
          { label: "In progress", value: kpis.open, color: STATUS_BG.neutral },
        ]}
      />
    </div>

    <div>
      <p className={label}>Payment mix (completed sales)</p>
      <SplitBar
        ariaLabel="Completed sales by payment method"
        segments={payments.map((p) => ({
          label: paymentLabel(p.method),
          value: p.gross,
          color: METHOD_COLORS[p.method] ?? STATUS_BG.neutral,
          display: `${p.orders} · ${inr(p.gross)}`,
        }))}
      />
    </div>

    <div className="grid grid-cols-2 gap-2">
      {[
        { title: "Median accept time", value: timing.medianAcceptMin },
        { title: "Median prep time", value: timing.medianPrepMin },
      ].map((t) => (
        <div key={t.title} className="rounded-xl bg-slate-50 dark:bg-zinc-800/60 p-3">
          <p className="text-[10px] font-bold uppercase tracking-wider text-slate-500 dark:text-zinc-400">{t.title}</p>
          <p className="mt-0.5 text-lg font-black text-slate-900 dark:text-zinc-100">
            {t.value === null ? "—" : `${t.value} min`}
          </p>
        </div>
      ))}
    </div>
  </div>
);
