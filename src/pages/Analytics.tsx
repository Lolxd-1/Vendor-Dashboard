import { useMemo, useState } from "react";
import toast from "react-hot-toast";
import { AlertCircle, AlertTriangle, CheckCircle2, FileDown, Lightbulb, RefreshCw, TrendingDown, TrendingUp } from "lucide-react";
import { useAuthStore } from "../stores/useAuthStore";
import { useAllOrders } from "../hooks/useAllOrders";
import { allTimeRange, buildReport, type Insight } from "../utils/analytics/report";
import {
  PRESET_LABELS,
  addDays,
  payoutDateOf,
  presetRange,
  settlementWeekOf,
  startOfDay,
  type DateRange,
  type PeriodPreset,
} from "../utils/analytics/period";
import { loadCommissionPct, saveCommissionPct } from "../utils/analytics/commission";
import { dayLabel, deltaPct, inr, pctText, rangeLabel } from "../utils/analytics/format";
import { downloadSalesReportPdf } from "../utils/analytics/salesReportPdf";
import { PeriodBar } from "../components/analytics/PeriodBar";
import { CommissionControl } from "../components/analytics/CommissionControl";
import { Panel, StatTile } from "../components/analytics/ui";
import { SalesTrendChart } from "../components/analytics/SalesTrendChart";
import { SettlementTable } from "../components/analytics/SettlementTable";
import { OperationsPanel } from "../components/analytics/OperationsPanel";
import { PeakHeatmap } from "../components/analytics/PeakHeatmap";
import { ItemsPanel } from "../components/analytics/ItemsPanel";
import { CustomersPanel } from "../components/analytics/CustomersPanel";

const chip =
  "flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-slate-100 dark:bg-zinc-800 border border-slate-200 dark:border-zinc-700 text-slate-600 dark:text-zinc-300 text-xs font-semibold hover:bg-[#1e40af]/10 hover:border-[#1e40af]/30 hover:text-[#1e40af] dark:hover:bg-blue-500/10 dark:hover:text-blue-400 transition-all duration-200 disabled:opacity-50 active:scale-95";

const TONES: Record<Insight["tone"], { icon: typeof Lightbulb; cls: string }> = {
  good: { icon: CheckCircle2, cls: "text-[#0ca30c]" },
  warn: { icon: AlertTriangle, cls: "text-[#ec835a]" },
  info: { icon: Lightbulb, cls: "text-[#2a78d6] dark:text-[#3987e5]" },
};

const HeroDelta = ({ value }: { value: number | null }) => {
  if (value === null) return <p className="mt-2 text-xs text-blue-100">No earlier period to compare</p>;
  const Icon = value >= 0 ? TrendingUp : TrendingDown;
  return (
    <p className="mt-2 inline-flex items-center gap-1.5 rounded-full bg-white/15 px-2.5 py-1 text-xs font-semibold">
      <Icon size={13} aria-hidden />
      {value >= 0 ? "+" : "−"}
      {pctText(Math.abs(value))} vs previous period
    </p>
  );
};

const Analytics = () => {
  const shopId = useAuthStore((s) => s.shopId);
  const { orders, error, progress, loadedAt, reload } = useAllOrders(shopId);

  // "Now" moves on whenever the vendor acts, so the current week stays current.
  const [now, setNow] = useState(() => new Date());
  const [preset, setPreset] = useState<PeriodPreset>("SETTLEMENT_WEEK");
  const [weekOffset, setWeekOffset] = useState(0);
  const [customStart, setCustomStart] = useState<Date | null>(null);
  const [customEnd, setCustomEnd] = useState<Date | null>(null);
  const [pct, setPct] = useState(() => loadCommissionPct(shopId));

  const week = useMemo(() => {
    const current = settlementWeekOf(now);
    return { start: addDays(current.start, 7 * weekOffset), end: addDays(current.end, 7 * weekOffset) };
  }, [now, weekOffset]);

  const range = useMemo((): DateRange | null => {
    switch (preset) {
      case "SETTLEMENT_WEEK":
        return week;
      case "ALL_TIME":
        return allTimeRange(orders ?? [], now);
      case "CUSTOM":
        return customStart && customEnd
          ? { start: startOfDay(customStart), end: addDays(startOfDay(customEnd), 1) }
          : null;
      default:
        return presetRange(preset, now);
    }
  }, [preset, week, orders, now, customStart, customEnd]);

  const report = useMemo(
    () => (orders && range ? buildReport(orders, range, pct, now) : null),
    [orders, range, pct, now]
  );

  const choosePreset = (p: PeriodPreset) => {
    setNow(new Date());
    setPreset(p);
    setWeekOffset(0);
  };
  const shiftWeek = (delta: number) => {
    setNow(new Date());
    setWeekOffset((o) => Math.min(0, o + delta));
  };
  const openWeek = (index: number) => {
    setNow(new Date());
    setPreset("SETTLEMENT_WEEK");
    setWeekOffset(-index);
  };
  const changePct = (value: number) => {
    saveCommissionPct(shopId, value);
    setPct(value);
  };
  const refresh = () => {
    setNow(new Date());
    reload();
  };

  const isWeek = preset === "SETTLEMENT_WEEK";

  const [pdfBusy, setPdfBusy] = useState(false);
  const downloadPdf = async () => {
    if (!report) return;
    setPdfBusy(true);
    try {
      await downloadSalesReportPdf(report, {
        shopName:
          sessionStorage.getItem("vendorName") ||
          orders?.find((o) => o.shopDetails?.name)?.shopDetails?.name ||
          `Store #${shopId ?? ""}`,
        periodLabel: PRESET_LABELS[preset],
        isSettlementWeek: isWeek,
      });
      toast.success("Sales report downloaded");
    } catch {
      toast.error("Couldn't create the PDF. Please try again.");
    } finally {
      setPdfBusy(false);
    }
  };

  return (
    <div className="space-y-4 px-4 pt-4 pb-6 lg:space-y-5 lg:p-0">
      {/* Header */}
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-lg font-bold text-slate-900 dark:text-zinc-100 lg:text-xl lg:font-semibold">Analytics</h2>
          <p className="mt-0.5 text-xs text-slate-400 dark:text-zinc-500">
            Sales and payouts count completed orders only
            {loadedAt && ` · updated ${loadedAt.toLocaleTimeString("en-IN", { hour: "numeric", minute: "2-digit" })}`}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <CommissionControl pct={pct} onChange={changePct} />
          <button type="button" onClick={downloadPdf} disabled={!report || pdfBusy} className={chip}>
            <FileDown size={13} />
            {pdfBusy ? "Preparing..." : "Download PDF"}
          </button>
          <button type="button" onClick={refresh} disabled={!!progress} className={chip}>
            <RefreshCw size={13} className={progress ? "animate-spin" : ""} />
            {progress ? "Loading..." : "Refresh"}
          </button>
        </div>
      </div>

      <PeriodBar
        preset={preset}
        onPreset={choosePreset}
        week={isWeek ? week : null}
        weekOffset={weekOffset}
        onWeekShift={shiftWeek}
        customStart={customStart}
        customEnd={customEnd}
        onCustomChange={(start, end) => {
          setNow(new Date());
          setCustomStart(start);
          setCustomEnd(end);
        }}
      />

      {error && orders && (
        <p role="alert" className="rounded-xl border border-rose-500/30 bg-rose-500/5 px-3 py-2 text-xs text-rose-600 dark:text-rose-400">
          Refresh failed: {error}. Showing the data loaded earlier.
        </p>
      )}

      {!orders &&
        (error ? (
          <div className="flex flex-col items-center justify-center py-16 text-rose-500 dark:text-rose-400">
            <AlertCircle size={32} className="mb-2" />
            <p className="text-sm font-medium">Couldn't load your orders: {error}</p>
            <button
              type="button"
              onClick={refresh}
              className="mt-3 rounded-lg border border-rose-500/30 px-4 py-1.5 text-xs hover:bg-rose-500/10 transition"
            >
              Try again
            </button>
          </div>
        ) : (
          <div className="mx-auto max-w-sm py-16 text-center">
            <RefreshCw size={22} className="mx-auto mb-3 animate-spin text-slate-400 dark:text-zinc-500" />
            <p className="text-sm text-slate-600 dark:text-zinc-300">
              Loading your order history…{progress && progress.total > 1 && ` page ${progress.loaded} of ${progress.total}`}
            </p>
            {progress && progress.total > 1 && (
              <div className="mt-3 h-1.5 rounded-full bg-slate-200 dark:bg-zinc-800">
                <div
                  className="h-1.5 rounded-full bg-[#1e40af] dark:bg-blue-500 transition-all"
                  style={{ width: `${(progress.loaded / progress.total) * 100}%` }}
                />
              </div>
            )}
          </div>
        ))}

      {orders && !range && (
        <p className="py-10 text-center text-sm text-slate-500 dark:text-zinc-400">
          Pick a start and end date to see this period.
        </p>
      )}

      {report && (
        <>
          {/* Hero: the money the vendor actually receives */}
          <section
            aria-label="Net payout summary"
            className="rounded-2xl bg-gradient-to-br from-[#1e40af] to-[#2563eb] p-5 text-white shadow-md lg:p-6"
          >
            <div className="flex flex-col gap-5 lg:flex-row lg:items-center lg:justify-between">
              <div className="min-w-0">
                <p className="text-[11px] font-bold uppercase tracking-wider text-blue-100">
                  {isWeek && weekOffset === 0 ? "Net payout so far" : "Net payout"}
                </p>
                <p className="mt-1 text-4xl font-black tracking-tight lg:text-5xl">{inr(report.kpis.net)}</p>
                <p className="mt-2 text-xs text-blue-100">
                  {rangeLabel(report.range)}
                  {isWeek && ` · paid ${dayLabel(payoutDateOf(report.range))}`}
                </p>
                <HeroDelta value={deltaPct(report.kpis.net, report.previousKpis.net)} />
              </div>
              <dl className="w-full space-y-2 rounded-xl bg-white/10 p-4 text-sm lg:w-80">
                <div className="flex justify-between gap-4">
                  <dt className="text-blue-100">Gross sales ({report.kpis.completed} completed)</dt>
                  <dd className="font-semibold tabular-nums">{inr(report.kpis.gross)}</dd>
                </div>
                <div className="flex justify-between gap-4">
                  <dt className="text-blue-100">Commission ({report.commissionPct}%)</dt>
                  <dd className="font-semibold tabular-nums">− {inr(report.kpis.commission)}</dd>
                </div>
                <div className="flex justify-between gap-4 border-t border-white/20 pt-2">
                  <dt className="font-bold">Net payout</dt>
                  <dd className="font-black tabular-nums">{inr(report.kpis.net)}</dd>
                </div>
              </dl>
            </div>
          </section>

          {/* KPI tiles, each compared with the previous period */}
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
            <StatTile
              label="Gross sales"
              value={inr(report.kpis.gross)}
              delta={deltaPct(report.kpis.gross, report.previousKpis.gross)}
              hint="Before commission"
            />
            <StatTile
              label="Completed orders"
              value={String(report.kpis.completed)}
              delta={deltaPct(report.kpis.completed, report.previousKpis.completed)}
              hint={`${pctText(report.kpis.completionRate)} of ${report.kpis.orders} orders`}
            />
            <StatTile
              label="Avg order value"
              value={inr(report.kpis.aov)}
              delta={deltaPct(report.kpis.aov, report.previousKpis.aov)}
            />
            <StatTile
              label="Customers"
              value={String(report.kpis.customers)}
              delta={deltaPct(report.kpis.customers, report.previousKpis.customers)}
              hint={`${report.customers.newCount} new · ${report.customers.returningCount} returning`}
            />
            <StatTile
              label="Items sold"
              value={String(report.kpis.itemsSold)}
              delta={deltaPct(report.kpis.itemsSold, report.previousKpis.itemsSold)}
            />
            <StatTile
              label="Cancelled"
              value={String(report.kpis.cancelled)}
              delta={deltaPct(report.kpis.cancelled, report.previousKpis.cancelled)}
              upIsGood={false}
              hint={`${pctText(report.kpis.cancelRate)} of orders`}
            />
            <StatTile
              label="Rejected"
              value={String(report.kpis.rejected)}
              delta={deltaPct(report.kpis.rejected, report.previousKpis.rejected)}
              upIsGood={false}
              hint={`${pctText(report.kpis.rejectRate)} of orders`}
            />
            <StatTile
              label="Lost sales"
              value={inr(report.kpis.lostValue)}
              delta={deltaPct(report.kpis.lostValue, report.previousKpis.lostValue)}
              upIsGood={false}
              hint="Cancelled + rejected"
            />
          </div>

          <div className="grid gap-4 lg:grid-cols-3 lg:gap-5">
            <Panel title="Insights" subtitle="What stands out in this period">
              <ul className="space-y-3">
                {report.insights.map((insight) => {
                  const tone = TONES[insight.tone];
                  return (
                    <li key={insight.text} className="flex gap-2.5 text-xs leading-relaxed text-slate-700 dark:text-zinc-200">
                      <tone.icon size={15} className={`mt-0.5 shrink-0 ${tone.cls}`} aria-hidden />
                      {insight.text}
                    </li>
                  );
                })}
              </ul>
            </Panel>
            <Panel
              title="Sales trend"
              subtitle={`Completed sales per ${report.series.grain}`}
              className="lg:col-span-2"
            >
              <SalesTrendChart points={report.series.points} grain={report.series.grain} />
            </Panel>
          </div>

          <Panel title="Weekly settlements" subtitle="Monday–Sunday weeks, paid the following Monday. Tap a week to open it.">
            <SettlementTable weeks={report.settlements} selectedStart={isWeek ? report.range.start : null} onSelect={openWeek} />
          </Panel>

          <div className="grid gap-4 lg:grid-cols-3 lg:gap-5">
            <Panel title="Top items" subtitle="Completed orders" className="lg:col-span-2">
              <ItemsPanel items={report.items} pairs={report.pairs} />
            </Panel>
            <Panel title="Orders & payments">
              <OperationsPanel kpis={report.kpis} payments={report.payments} timing={report.timing} />
            </Panel>
          </div>

          <Panel title="Peak hours" subtitle="When orders come in (all statuses)">
            <PeakHeatmap cells={report.heatmap.cells} max={report.heatmap.max} />
          </Panel>

          <Panel title="Customers" subtitle="Completed orders · new means first-ever order with you">
            <CustomersPanel customers={report.customers} cohorts={report.cohorts} />
          </Panel>
        </>
      )}
    </div>
  );
};

export default Analytics;
