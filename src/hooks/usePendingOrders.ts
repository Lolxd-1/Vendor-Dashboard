import { useState } from "react";
import toast from "react-hot-toast";
import { useAcceptOrderMutation, useRejectOrderMutation } from "../apis/dashboardApi";
import { useDashboardStore } from "../stores/useDashboardStore";
import type { Order } from "../types/order";
import { buildCounterBill, buildKitchenKOT } from "../utils/print/billTemplates";
import { printText } from "../utils/print/printAgent";

export const usePendingOrder = (order: Order | string) => {
  const orderId = typeof order === "string" ? order : order.orderId;
  const fullOrder = typeof order === "string" ? null : order;
  // ─── Local UI States ───
  const [prepTime, setPrepTime] = useState<number>(15);
  const [showRejectForm, setShowRejectForm] = useState<boolean>(false);
  const [rejectReason, setRejectReason] = useState<string>("");
  const [reasonError, setReasonError] = useState<string>("");

  // ─── Global Store & APIs ───
  const { moveToAccepted, removeOrder } = useDashboardStore();
  const [acceptOrder, { isLoading: isAccepting }] = useAcceptOrderMutation();
  const [rejectOrder, { isLoading: isRejecting }] = useRejectOrderMutation();

  // ─── Action Handlers ───
  const handleAccept = async () => {
    try {
      await acceptOrder({ orderId, preparationTime: prepTime }).unwrap();
      moveToAccepted(orderId, prepTime);
      toast.success(`Order ${orderId} Accepted`);

      // ─── Auto-print BOTH slips in sync (Counter Bill + Kitchen KOT) ───
      // Order object + chosen prepTime gives kitchen confusion-proof chit
      // with Order ID + price. Idempotent per order via sessionStorage.
      try {
        if (fullOrder && sessionStorage.getItem(`qv_printed_${orderId}`) !== "1") {
          const orderForPrint: Order = { ...fullOrder, preparationTime: prepTime, state: "ACCEPTED" };
          const [billRes, kotRes] = await Promise.all([
            printText("counter", buildCounterBill(orderForPrint, prepTime)),
            printText("kitchen", buildKitchenKOT(orderForPrint, prepTime)),
          ]);
          if (billRes === "agent" && kotRes === "agent") {
            sessionStorage.setItem(`qv_printed_${orderId}`, "1");
            toast.success("Bill + KOT sent to printer");
          } else if (billRes !== "failed" || kotRes !== "failed") {
            sessionStorage.setItem(`qv_printed_${orderId}`, "1");
            toast("Print window opened — confirm to print", { icon: "🖨️" });
          } else {
            toast.error("Printer not found — use Reprint on Accepted card");
          }
        }
      } catch {
        toast.error("Accepted, but auto-print failed — use Reprint");
      }
    } catch (error) {
      toast.error(`Failed to accept order ${orderId}`);
    }
  };

  const handleConfirmReject = async () => {
   const trimmedReason = rejectReason.trim();
    
    if (trimmedReason.length < 3) {
      setReasonError("Reason must be at least 3 characters long.");
      return;
    }
    
    setReasonError(""); // Clear error if valid

    try {
      // API call with the dynamically entered reason
      await rejectOrder({ orderId, reason: rejectReason }).unwrap();
      removeOrder(orderId);
      toast.success(`Order ${orderId} Rejected`);
    } catch (error) {
      toast.error(`Failed to reject order ${orderId}`);
    }
  };

  const handleCancelReject = () => {
    setShowRejectForm(false);
    setRejectReason("");
    setReasonError("");
  };

  return {
    prepTime,
    setPrepTime,
    showRejectForm,
    setShowRejectForm,
    rejectReason,
    setRejectReason,
    isAccepting,
    isRejecting,
    reasonError,
    setReasonError,
    handleAccept,
    handleConfirmReject,
    handleCancelReject
  };
};