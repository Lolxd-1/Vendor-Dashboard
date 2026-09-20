import { useEffect, useState } from "react";
import { Printer, X, RefreshCw } from "lucide-react";
import {
  getPrinterSettings,
  savePrinterSettings,
  checkAgentOnline,
  getAgentPrinterDetails,
  getRealPrinterNames,
  getShowAllPrinters,
  setShowAllPrinters,
  getAgentVersion,
  getAgentQueue,
  REQUIRED_AGENT_VERSION,
  type PrinterInfo,
  type QueueInfo,
} from "../../utils/print/printAgent";
import { buildCounterBill, buildKitchenKOT } from "../../utils/print/billTemplates";
import { printTextDetailed } from "../../utils/print/printAgent";
import toast from "react-hot-toast";

// exp1: One-time setup per shop PC. Dropdowns list REAL printers by default
// (USB / network / thermal). Virtual queues (PDF/XPS/OneNote/Fax) are hidden
// unless "Show all printers" is ticked. Summary card shows exactly what
// prints where. Accept-flow + templates untouched.
export const PrinterSettingsModal = ({ onClose }: { onClose: () => void }) => {
  const [counter, setCounter] = useState("");
  const [kitchen, setKitchen] = useState("");
  const [gstin, setGstin] = useState("");
  const [fssai, setFssai] = useState("");
  const [agentOk, setAgentOk] = useState<boolean | null>(null);
  const [detail, setDetail] = useState<PrinterInfo[]>([]);
  const [agentVersion, setAgentVersion] = useState<string | null>(null);
  const [samePrinter, setSamePrinter] = useState(true);
  const [showAll, setShowAll] = useState(false);
  const [loadingPrinters, setLoadingPrinters] = useState(false);
  const [queues, setQueues] = useState<QueueInfo[]>([]);

  const allNames = detail.map((d) => d.name);
  const realNames = getRealPrinterNames(detail);
  const visibleNames = showAll ? allNames : realNames;
  // Map for virtual badge in dropdown labels
  const virtualSet = new Set(detail.filter((d) => d.isVirtual).map((d) => d.name));

  const refreshPrinters = async (savedCounter?: string, savedKitchen?: string) => {
    setLoadingPrinters(true);
    try {
      const ok = await checkAgentOnline();
      setAgentOk(ok);
      const ver = await getAgentVersion();
      setAgentVersion(ver);
      if (!ok) return;
      const [d, q] = await Promise.all([getAgentPrinterDetails(), getAgentQueue()]);
      setDetail(d);
      setQueues(q);
      if (d.length) {
        const all = d.map((x) => x.name);
        const real = getRealPrinterNames(d);
        const curCounter = (savedCounter ?? counter).trim();
        const curKitchen = (savedKitchen ?? kitchen).trim();
        // Auto-fix legacy default (TM-T82 without X) when the X queue exists
        if (all.includes("EPSON TM-T82X Receipt")) {
          if (!all.includes(curCounter)) setCounter("EPSON TM-T82X Receipt");
          if (!all.includes(curKitchen)) setKitchen("EPSON TM-T82X Receipt");
          return;
        }
        // exp1 suggestion only when saved value is missing/unknown:
        // single real -> point both at it; 2+ reals -> counter=first, kitchen=second.
        // Never overwrites a saved name that still exists.
        if (real.length) {
          if (!curCounter || !all.includes(curCounter)) {
            setCounter(real[0]);
            if (samePrinter) setKitchen(real[0]);
          }
          if (!samePrinter && (!curKitchen || !all.includes(curKitchen))) {
            setKitchen(real.length > 1 ? real[1] : real[0]);
          }
        }
      }
    } finally {
      setLoadingPrinters(false);
    }
  };

  useEffect(() => {
    const s = getPrinterSettings();
    setCounter(s.counterPrinter);
    setKitchen(s.kitchenPrinter);
    setSamePrinter(s.counterPrinter === s.kitchenPrinter);
    setGstin(localStorage.getItem("qv_gstin") || "");
    setFssai(localStorage.getItem("qv_fssai") || "");
    setShowAll(getShowAllPrinters());
    refreshPrinters(s.counterPrinter, s.kitchenPrinter);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const toggleShowAll = (v: boolean) => {
    setShowAll(v);
    setShowAllPrinters(v);
  };

  const save = (nextCounter = counter.trim(), nextKitchen = kitchen.trim()) => {
    if (!nextCounter) {
      toast.error("Pick Counter Bill printer");
      return;
    }
    const finalKitchen = samePrinter ? nextCounter : nextKitchen;
    if (!samePrinter && !finalKitchen) {
      toast.error("Pick Kitchen KOT printer or tick Single printer");
      return;
    }
    // exp1 validation: selected names should exist in detected list when agent is online.
    // Blocks virtual picks while hidden, so Bill/KOT never go to PDF/XPS by accident.
    if (agentOk && allNames.length) {
      if (!allNames.includes(nextCounter)) {
        toast.error(`Counter "${nextCounter}" not found — pick from detected list`);
        return;
      }
      if (!allNames.includes(finalKitchen)) {
        toast.error(`Kitchen "${finalKitchen}" not found — pick from detected list`);
        return;
      }
      if (!showAll && virtualSet.has(nextCounter)) {
        toast.error(`"${nextCounter}" looks virtual — tick "Show all printers" to use it`);
        return;
      }
      if (!showAll && virtualSet.has(finalKitchen)) {
        toast.error(`"${finalKitchen}" looks virtual — tick "Show all printers" to use it`);
        return;
      }
    }
    savePrinterSettings({ counterPrinter: nextCounter, kitchenPrinter: finalKitchen, agentPort: 1818 });
    localStorage.setItem("qv_gstin", gstin.trim());
    localStorage.setItem("qv_fssai", fssai.trim());
    toast.success(
      samePrinter || nextCounter === finalKitchen
        ? `Saved — ${nextCounter} prints Bill + KOT`
        : `Saved — Counter ${nextCounter} → Bill, Kitchen ${finalKitchen} → KOT`
    );
    onClose();
  };

  const testPrint = async (kind: "counter" | "kitchen") => {
    const demo: any = {
      orderId: "TEST-123",
      creationTime: new Date().toISOString(),
      fulfillmentOption: "Delivery",
      paymentMethod: "Online",
      customerName: "Test Customer",
      customerMobile: 9876543210,
      amountExcludingDeliveryFee: 250,
      invoiceAmount: 250,
      preparationTime: 15,
      orderItem: [{ id: 1, name: "Paneer Tikka Biryani", itemCount: 1, itemPrice: 250 }],
      shopDetails: { name: "Heaven Game Restro", address: { address: "Canal Road, Beed 431122", city: "", state: "", postalCode: "" } },
    };
    const text = kind === "counter" ? buildCounterBill(demo, 15) : buildKitchenKOT(demo, 15);
    // Temporarily override name for the test target
    const s = getPrinterSettings();
    const target = kind === "counter" ? counter.trim() : kitchen.trim();
    savePrinterSettings({ ...s, counterPrinter: kind === "counter" ? target : s.counterPrinter, kitchenPrinter: kind === "kitchen" ? target : s.kitchenPrinter });
    // exp2: honest result — surface agent refusal reason instead of lying.
    const res = await printTextDetailed(kind, text);
    if (res.where === "agent") toast.success(`Test sent to ${target}`);
    else if (res.where === "browser") toast("Agent not running — print window opened", { icon: "🖨️" });
    else toast.error(`Test failed: ${res.error || "helper unreachable"}`, { duration: 6000 });
  };

  const counterTrim = counter.trim();
  const kitchenTrim = (samePrinter ? counterTrim : kitchen.trim());
  const isDual = !!counterTrim && !!kitchenTrim && counterTrim !== kitchenTrim && !samePrinter;
  // exp2: spooler truth for the SELECTED queues (not all queues).
  const queueByName = new Map(queues.map((q) => [q.name, q]));
  const counterQ = counterTrim ? queueByName.get(counterTrim) : undefined;
  const kitchenQ = !samePrinter && kitchenTrim ? queueByName.get(kitchenTrim) : undefined;
  const queueWarnings = [counterQ, kitchenQ].filter((q) => q && q.hasError) as QueueInfo[];

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center bg-slate-900/60 p-4" onClick={onClose}>
      <div className="w-full max-w-md bg-white dark:bg-zinc-900 rounded-2xl p-5 shadow-2xl max-h-[92vh] overflow-y-auto" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-sm font-black flex items-center gap-2"><Printer size={16} /> Printer Setup</h3>
          <button onClick={onClose} className="p-1.5 rounded-lg bg-slate-100 dark:bg-zinc-800"><X size={16} /></button>
        </div>

        <div className={`text-[11px] font-bold px-3 py-2 rounded-lg mb-3 ${agentOk ? "bg-green-50 text-green-700" : "bg-amber-50 text-amber-700"}`}>
          {agentOk === null ? "Checking helper..." : agentOk ? `● Helper Online${agentVersion ? ` v${agentVersion}` : ""} — silent auto-print ready` : "● Helper not found — will use browser print. Install print-agent on billing PC."}
        </div>
        {agentOk && agentVersion && agentVersion !== REQUIRED_AGENT_VERSION && (
          <div className="text-[11px] font-bold px-3 py-2 rounded-lg mb-3 bg-red-50 text-red-700">
            Agent v{agentVersion} found — please update to v{REQUIRED_AGENT_VERSION} (exp2 build) before scaling.
          </div>
        )}
        {/* exp2: spooler truth — selected queue has paper-out/offline/stuck jobs */}
        {queueWarnings.length > 0 && (
          <div className="text-[11px] font-bold px-3 py-2 rounded-lg mb-3 bg-red-50 text-red-700">
            {queueWarnings.map((q) => (
              <div key={q.name}>● {q.name}: {q.errorText || q.status}{q.jobs ? ` — ${q.jobs} job(s) stuck` : ""}. Fix paper/cable → Reprint.</div>
            ))}
          </div>
        )}

        {/* exp1: live counts + show-all toggle + refresh */}
        <div className="flex items-center justify-between gap-2 mb-3 px-1">
          <span className="text-[11px] font-bold text-slate-500">
            {loadingPrinters
              ? "Scanning printers…"
              : agentOk
                ? detail.length
                  ? `${realNames.length} real found (${allNames.length} total)`
                  : "No printers detected"
                : "Helper offline — showing saved names"}
          </span>
          <button
            onClick={() => refreshPrinters()}
            disabled={loadingPrinters}
            className="flex items-center gap-1 text-[11px] font-bold text-blue-600 disabled:opacity-50"
          >
            <RefreshCw size={12} className={loadingPrinters ? "animate-spin" : ""} /> Refresh
          </button>
        </div>
        <label className="flex items-center gap-2 text-[11px] font-bold text-slate-600 dark:text-zinc-300 mb-3 px-1">
          <input type="checkbox" checked={showAll} onChange={(e) => toggleShowAll(e.target.checked)} />
          Show all printers (incl. PDF / XPS / Fax)
        </label>

        {/* exp1: current-setup summary — what prints where */}
        <div className={`text-[11px] font-bold px-3 py-2 rounded-lg mb-4 ${isDual ? "bg-blue-50 text-blue-800 dark:bg-blue-900/20 dark:text-blue-300" : "bg-slate-100 text-slate-700 dark:bg-zinc-800 dark:text-zinc-200"}`}>
          {isDual ? (
            <>● Dual mode — Counter <b>{counterTrim}</b> → Bill · Kitchen <b>{kitchenTrim}</b> → KOT. Accept prints both.</>
          ) : counterTrim ? (
            <>● Single-printer mode — <b>{counterTrim}</b> prints Bill + KOT back-to-back. Accept prints both.</>
          ) : (
            <>● No printers selected yet — pick Counter (+ Kitchen) below, then Save.</>
          )}
        </div>

        <label className="flex items-center gap-2 text-[11px] font-bold uppercase text-slate-500 mb-3">
          <input type="checkbox" checked={samePrinter} onChange={(e) => {
            const v = e.target.checked;
            setSamePrinter(v);
            if (v) setKitchen(counter);
          }} />
          Single printer (Bill + KOT on same queue)
        </label>

        <label className="text-[11px] font-bold uppercase text-slate-500">Counter Bill Printer → prints Bill</label>
        {visibleNames.length ? (
          <select value={counter} onChange={(e) => { setCounter(e.target.value); if (samePrinter) setKitchen(e.target.value); }}
            className="w-full text-sm px-3 py-2 mt-1 mb-2 border rounded-lg bg-white dark:bg-zinc-800">
            {!visibleNames.includes(counter) && <option value={counter}>{counter ? `${counter} (saved)` : "— Select printer —"}</option>}
            {visibleNames.map((p) => (
              <option key={p} value={p}>{p}{virtualSet.has(p) ? " (virtual)" : ""}</option>
            ))}
          </select>
        ) : (
          <input value={counter} onChange={(e) => { setCounter(e.target.value); if (samePrinter) setKitchen(e.target.value); }} placeholder="EPSON TM-T82X Receipt"
            className="w-full text-sm px-3 py-2 mt-1 mb-2 border rounded-lg bg-white dark:bg-zinc-800" />
        )}
        <button onClick={() => testPrint("counter")} className="text-[11px] font-bold text-blue-600 mb-3">Test Counter Print (Bill)</button>

        <label className="text-[11px] font-bold uppercase text-slate-500">Kitchen KOT Printer → prints KOT</label>
        {visibleNames.length && !samePrinter ? (
          <select value={kitchen} onChange={(e) => setKitchen(e.target.value)}
            className="w-full text-sm px-3 py-2 mt-1 mb-2 border rounded-lg bg-white dark:bg-zinc-800">
            {!visibleNames.includes(kitchen) && <option value={kitchen}>{kitchen ? `${kitchen} (saved)` : "— Select printer —"}</option>}
            {visibleNames.map((p) => (
              <option key={p} value={p}>{p}{virtualSet.has(p) ? " (virtual)" : ""}</option>
            ))}
          </select>
        ) : (
          <input value={kitchen} disabled={samePrinter} onChange={(e) => setKitchen(e.target.value)} placeholder="EPSON TM-T82X Receipt"
            className="w-full text-sm px-3 py-2 mt-1 mb-2 border rounded-lg bg-white dark:bg-zinc-800 disabled:opacity-60" />
        )}
        <button onClick={() => testPrint("kitchen")} className="text-[11px] font-bold text-blue-600 mb-3">Test Kitchen Print (KOT)</button>

        <div className="grid grid-cols-2 gap-2 mb-4">
          <div>
            <label className="text-[11px] font-bold uppercase text-slate-500">GSTIN</label>
            <input value={gstin} onChange={(e) => setGstin(e.target.value)} placeholder="27XXXXX0000X1Z5"
              className="w-full text-sm px-3 py-2 mt-1 border rounded-lg bg-white dark:bg-zinc-800" />
          </div>
          <div>
            <label className="text-[11px] font-bold uppercase text-slate-500">FSSAI</label>
            <input value={fssai} onChange={(e) => setFssai(e.target.value)} placeholder="14-digit"
              className="w-full text-sm px-3 py-2 mt-1 border rounded-lg bg-white dark:bg-zinc-800" />
          </div>
        </div>

        <button onClick={() => save()} className="w-full py-2.5 bg-blue-600 hover:bg-blue-700 text-white rounded-lg text-xs font-bold uppercase tracking-wider">Save</button>
        <p className="text-[10px] text-slate-400 mt-2">Names must match Windows Settings → Printers exactly. Same queue PetPooja uses — jobs line up, never mix. Unticked = real printers only; tick to see PDF/XPS/Fax.</p>
      </div>
    </div>
  );
};
