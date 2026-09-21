import { useState } from "react";
import toast from "react-hot-toast";
import type { Order } from "../types/order";
import { buildCounterBill, buildKitchenKOT } from "../utils/print/billTemplates";
import { printTextDetailed, checkAgentOnline, type PrintOutcome } from "../utils/print/printAgent";
import { claimPrint, releasePrint } from "../utils/print/printLedger";

// exp2: honest toasts. "Sent to printer" is shown ONLY when the agent
// actually accepted the job (HTTP 200). Agent refusals surface the reason
// (e.g. "Printer not found: X", "helper unreachable") instead of lying.
const describe = (o: PrintOutcome, label: string) =>
  `${label} → ${o.printer}${o.error ? `: ${o.error}` : ""}`;

export const usePrintOrder = () => {
  const [printing, setPrinting] = useState(false);
  const [agentOnline, setAgentOnline] = useState<boolean | null>(null);

  const refreshAgentStatus = async () => {
    const ok = await checkAgentOnline();
    setAgentOnline(ok);
    return ok;
  };

  // Called right after Accept succeeds — prints BOTH slips in sync.
  const printBothOnAccept = async (order: Order, prepTime: number) => {
    // Claim BEFORE the awaits: the flag is set while this call still owns the
    // event loop, so a second accept for the same order cannot slip in behind it.
    if (!claimPrint(order.orderId)) return;
    setPrinting(true);
    try {
      const bill = buildCounterBill(order, prepTime);
      const kot = buildKitchenKOT(order, prepTime);
      const [billRes, kotRes] = await Promise.all([
        printTextDetailed("counter", bill),
        printTextDetailed("kitchen", kot),
      ]);
      const results = [
        { label: "Bill", out: billRes },
        { label: "KOT", out: kotRes },
      ];
      const failed = results.filter((r) => r.out.where === "failed");
      const browser = results.filter((r) => r.out.where === "browser");
      if (failed.length === 0 && browser.length === 0) {
        toast.success("Bill + KOT sent to printer");
      } else if (failed.length === results.length) {
        // Nothing reached a printer — hand the claim back so Reprint can retry.
        releasePrint(order.orderId);
        const reason = billRes.error || kotRes.error || "helper unreachable";
        toast.error(`Print failed: ${reason} — use Reprint`, { duration: 6000 });
      } else if (browser.length > 0 && failed.length === 0) {
        // Browser fallback opened for at least one slip, neither failed — staff
        // confirms once. The claim stands.
        toast("Print window opened — confirm to print", { icon: "🖨️" });
      } else {
        // Partial: one slip out, one failed — say exactly which, same shape as
        // reprint's partial branch. Never claim a window opened that didn't.
        toast.error(
          `Partial print — ${results.map((r) => `${r.label}:${r.out.where}${r.out.error ? ` (${r.out.error})` : ""}`).join(", ")} — use Reprint`,
          { duration: 6000 }
        );
      }
    } finally {
      setPrinting(false);
    }
  };

  const reprint = async (order: Order, kind: "bill" | "kot" | "both" = "both") => {
    setPrinting(true);
    try {
      const done: { label: string; out: PrintOutcome }[] = [];
      if (kind === "bill" || kind === "both") {
        done.push({ label: "Bill", out: await printTextDetailed("counter", buildCounterBill(order, order.preparationTime)) });
      }
      if (kind === "kot" || kind === "both") {
        done.push({ label: "KOT", out: await printTextDetailed("kitchen", buildKitchenKOT(order, order.preparationTime)) });
      }
      const failed = done.filter((d) => d.out.where === "failed");
      const browser = done.filter((d) => d.out.where === "browser");
      if (failed.length === 0 && browser.length === 0) {
        const targets = done.map((d) => `${d.label} → ${d.out.printer}`).join(" · ");
        toast.success(done.length > 1 ? `Bill + KOT sent (${targets})` : `Sent (${targets})`);
      } else if (failed.length === done.length) {
        toast.error(`Print failed: ${failed.map((d) => describe(d.out, d.label)).join(" · ")}`, { duration: 6000 });
      } else if (browser.length > 0 && failed.length === 0) {
        toast("Print window opened — confirm to print", { icon: "🖨️" });
      } else {
        // Partial: one slip out, one failed — say exactly which.
        toast.error(
          `Partial print — ${done.map((d) => `${d.label}:${d.out.where}${d.out.error ? ` (${d.out.error})` : ""}`).join(", ")}`,
          { duration: 6000 }
        );
      }
    } finally {
      setPrinting(false);
    }
  };

  return { printing, agentOnline, refreshAgentStatus, printBothOnAccept, reprint };
};
