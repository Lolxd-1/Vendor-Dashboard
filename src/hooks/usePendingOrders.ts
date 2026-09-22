import { useState } from "react";
import toast from "react-hot-toast";
import { useAcceptOrderMutation, useRejectOrderMutation } from "../apis/dashboardApi";
import { useDashboardStore } from "../stores/useDashboardStore";
import { markAcceptUnconfirmed } from "../utils/print/printLedger";
import type { Order } from "../types/order";
import { usePrintOrder } from "./usePrintOrder";

export const usePendingOrder = (order: Order | string) => {
  const orderId = typeof order === "string" ? order : order.orderId;
  const fullOrder = typeof order === "string" ? null : order;
  // ─── Local UI States ───
  const [prepTime, setPrepTime] = useState<number>(15);
  const [showRejectForm, setShowRejectForm] = useState<boolean>(false);
  const [rejectReason, setRejectReason] = useState<string>("");
  const [reasonError, setReasonError] = useState<string>("");

  // ─── Global Store & APIs ───
  const moveToAccepted = useDashboardStore((state) => state.moveToAccepted);
  const removeOrder = useDashboardStore((state) => state.removeOrder);
  const { printBothOnAccept } = usePrintOrder();
  const [acceptOrder, { isLoading: isAccepting }] = useAcceptOrderMutation();
  const [rejectOrder, { isLoading: isRejecting }] = useRejectOrderMutation();

  // ─── Action Handlers ───
  const handleAccept = async () => {
    try {
      await acceptOrder({ orderId, preparationTime: prepTime }).unwrap();
      moveToAccepted(orderId, prepTime);
      toast.success(`Order ${orderId} Accepted`);

      // ─── Auto-print BOTH slips in sync (Counter Bill + Kitchen KOT) ───
      if (fullOrder) {
        try {
          await printBothOnAccept(fullOrder, prepTime);
        } catch {
          toast.error("Accepted, but auto-print failed — use Reprint");
        }
      }
    } catch (error) {
      // The backend may have committed before the reply was lost, in which case
      // the next poll files this order into Accepted looking completely normal —
      // with no bill and no KOT. Never auto-retry or auto-print on this path;
      // the stamp makes the Accepted card say so for as long as that is true.
      markAcceptUnconfirmed(orderId);
      toast.error(
        `Failed to accept order ${orderId} — it may still have been accepted. Check the Accepted column before retrying, and Reprint from there.`,
        { duration: 8000 }
      );
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