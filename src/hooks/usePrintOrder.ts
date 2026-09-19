import { useState } from "react";
import toast from "react-hot-toast";
import type { Order } from "../types/order";
import { buildCounterBill, buildKitchenKOT } from "../utils/print/billTemplates";
import { printText, checkAgentOnline } from "../utils/print/printAgent";

// Idempotency: same order never double-prints on retry / re-render.
const wasPrinted = (orderId: string) => sessionStorage.getItem(`qv_printed_${orderId}`) === "1";
const markPrinted = (orderId: string) => sessionStorage.setItem(`qv_printed_${orderId}`, "1");

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
    if (wasPrinted(order.orderId)) return;
    setPrinting(true);
    try {
      const bill = buildCounterBill(order, prepTime);
      const kot = buildKitchenKOT(order, prepTime);
      const [billRes, kotRes] = await Promise.all([
        printText("counter", bill),
        printText("kitchen", kot),
      ]);
      if (billRes === "agent" && kotRes === "agent") {
        markPrinted(order.orderId);
        toast.success("Bill + KOT sent to printer");
      } else if (billRes === "failed" && kotRes === "failed") {
        toast.error("Printer not found — use Reprint");
      } else {
        // Browser fallback opened — staff confirms once.
        markPrinted(order.orderId);
        toast("Print window opened — confirm to print", { icon: "🖨️" });
      }
    } finally {
      setPrinting(false);
    }
  };

  const reprint = async (order: Order, kind: "bill" | "kot" | "both" = "both") => {
    setPrinting(true);
    try {
      if (kind === "bill" || kind === "both") {
        await printText("counter", buildCounterBill(order, order.preparationTime));
      }
      if (kind === "kot" || kind === "both") {
        await printText("kitchen", buildKitchenKOT(order, order.preparationTime));
      }
      toast.success("Sent to printer");
    } finally {
      setPrinting(false);
    }
  };

  return { printing, agentOnline, refreshAgentStatus, printBothOnAccept, reprint };
};
