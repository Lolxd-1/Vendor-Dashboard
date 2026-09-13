import { useState } from "react";
import toast from "react-hot-toast";
import { useAcceptOrderMutation, useRejectOrderMutation } from "../apis/dashboardApi";
import { useDashboardStore } from "../stores/useDashboardStore";

export const usePendingOrder = (orderId: string) => {
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