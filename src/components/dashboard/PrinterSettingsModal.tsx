import { useEffect, useState } from "react";
import { Printer, X } from "lucide-react";
import { getPrinterSettings, savePrinterSettings, checkAgentOnline, getAgentPrinters, getAgentVersion, REQUIRED_AGENT_VERSION } from "../../utils/print/printAgent";
import { buildCounterBill, buildKitchenKOT } from "../../utils/print/billTemplates";
import { printText } from "../../utils/print/printAgent";
import toast from "react-hot-toast";

// One-time setup per shop PC. Pick queues detected from the local agent
// (e.g. "EPSON TM-T82X Receipt"). Single-printer pilot: same name in both.
export const PrinterSettingsModal = ({ onClose }: { onClose: () => void }) => {
  const [counter, setCounter] = useState("");
  const [kitchen, setKitchen] = useState("");
  const [gstin, setGstin] = useState("");
  const [fssai, setFssai] = useState("");
  const [agentOk, setAgentOk] = useState<boolean | null>(null);
  const [agentPrinters, setAgentPrinters] = useState<string[]>([]);
  const [agentVersion, setAgentVersion] = useState<string | null>(null);
  const [samePrinter, setSamePrinter] = useState(true);

  useEffect(() => {
    const s = getPrinterSettings();
    setCounter(s.counterPrinter);
    setKitchen(s.kitchenPrinter);
    setSamePrinter(s.counterPrinter === s.kitchenPrinter);
    setGstin(localStorage.getItem("qv_gstin") || "");
    setFssai(localStorage.getItem("qv_fssai") || "");
    checkAgentOnline().then(setAgentOk);
    getAgentPrinters().then((list) => {
      if (list.length) {
        setAgentPrinters(list);
        // Auto-fix legacy default (TM-T82 without X) when the X queue exists
        if (list.includes("EPSON TM-T82X Receipt")) {
          if (!list.includes(s.counterPrinter)) setCounter("EPSON TM-T82X Receipt");
          if (!list.includes(s.kitchenPrinter)) setKitchen("EPSON TM-T82X Receipt");
        }
      }
    });
    getAgentVersion().then(setAgentVersion);
  }, []);

  const save = (nextCounter = counter.trim(), nextKitchen = kitchen.trim()) => {
    const finalKitchen = samePrinter ? nextCounter : nextKitchen;
    savePrinterSettings({ counterPrinter: nextCounter, kitchenPrinter: finalKitchen, agentPort: 1818 });
    localStorage.setItem("qv_gstin", gstin.trim());
    localStorage.setItem("qv_fssai", fssai.trim());
    toast.success("Printer settings saved");
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
    const res = await printText(kind, text);
    if (res === "agent") toast.success(`Test sent to ${target}`);
    else if (res === "browser") toast("Agent not running — print window opened", { icon: "🖨️" });
    else toast.error("Print failed");
  };

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center bg-slate-900/60 p-4" onClick={onClose}>
      <div className="w-full max-w-md bg-white dark:bg-zinc-900 rounded-2xl p-5 shadow-2xl" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-sm font-black flex items-center gap-2"><Printer size={16} /> Printer Setup</h3>
          <button onClick={onClose} className="p-1.5 rounded-lg bg-slate-100 dark:bg-zinc-800"><X size={16} /></button>
        </div>

        <div className={`text-[11px] font-bold px-3 py-2 rounded-lg mb-4 ${agentOk ? "bg-green-50 text-green-700" : "bg-amber-50 text-amber-700"}`}>
          {agentOk === null ? "Checking helper..." : agentOk ? `● Helper Online${agentVersion ? ` v${agentVersion}` : ""} — silent auto-print ready` : "● Helper not found — will use browser print. Install print-agent on billing PC."}
        </div>
        {agentOk && agentVersion && agentVersion !== REQUIRED_AGENT_VERSION && (
          <div className="text-[11px] font-bold px-3 py-2 rounded-lg mb-4 bg-red-50 text-red-700">
            Agent v{agentVersion} found — please update to v{REQUIRED_AGENT_VERSION} (GitHub Releases) before scaling.
          </div>
        )}

        <label className="flex items-center gap-2 text-[11px] font-bold uppercase text-slate-500 mb-3">
          <input type="checkbox" checked={samePrinter} onChange={(e) => {
            const v = e.target.checked;
            setSamePrinter(v);
            if (v) setKitchen(counter);
          }} />
          Single printer (Bill + KOT on same queue)
        </label>

        <label className="text-[11px] font-bold uppercase text-slate-500">Counter Bill Printer</label>
        {agentPrinters.length ? (
          <select value={counter} onChange={(e) => { setCounter(e.target.value); if (samePrinter) setKitchen(e.target.value); }}
            className="w-full text-sm px-3 py-2 mt-1 mb-2 border rounded-lg bg-white dark:bg-zinc-800">
            {agentPrinters.map((p) => <option key={p} value={p}>{p}</option>)}
            {!agentPrinters.includes(counter) && <option value={counter}>{counter} (saved)</option>}
          </select>
        ) : (
          <input value={counter} onChange={(e) => { setCounter(e.target.value); if (samePrinter) setKitchen(e.target.value); }} placeholder="EPSON TM-T82X Receipt"
            className="w-full text-sm px-3 py-2 mt-1 mb-2 border rounded-lg bg-white dark:bg-zinc-800" />
        )}
        <button onClick={() => testPrint("counter")} className="text-[11px] font-bold text-blue-600 mb-3">Test Counter Print</button>

        <label className="text-[11px] font-bold uppercase text-slate-500">Kitchen KOT Printer</label>
        {agentPrinters.length && !samePrinter ? (
          <select value={kitchen} onChange={(e) => setKitchen(e.target.value)}
            className="w-full text-sm px-3 py-2 mt-1 mb-2 border rounded-lg bg-white dark:bg-zinc-800">
            {agentPrinters.map((p) => <option key={p} value={p}>{p}</option>)}
            {!agentPrinters.includes(kitchen) && <option value={kitchen}>{kitchen} (saved)</option>}
          </select>
        ) : (
          <input value={kitchen} disabled={samePrinter} onChange={(e) => setKitchen(e.target.value)} placeholder="EPSON TM-T82X Receipt"
            className="w-full text-sm px-3 py-2 mt-1 mb-2 border rounded-lg bg-white dark:bg-zinc-800 disabled:opacity-60" />
        )}
        <button onClick={() => testPrint("kitchen")} className="text-[11px] font-bold text-blue-600 mb-3">Test Kitchen Print</button>

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
        <p className="text-[10px] text-slate-400 mt-2">Names must match Windows Settings → Printers exactly. Same queue PetPooja uses — jobs line up, never mix.</p>
      </div>
    </div>
  );
};
