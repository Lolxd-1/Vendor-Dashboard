import { Client } from "@stomp/stompjs";
import { CheckCircle, Info, XCircle } from 'lucide-react';
import { useEffect, useRef, useState } from "react";
import { toast } from 'react-hot-toast';
import SockJS from "sockjs-client";
import { baseurl } from "../apis";
import { isTokenExpired, useAuthStore } from "../stores/useAuthStore";
import { normalisePhase, useDashboardStore } from "../stores/useDashboardStore";

// ✅ Validator for new orders
const isValidOrder = (data: any): boolean => {
  if (typeof data !== "object" || data === null) return false;
  
  // It should at least have an orderId
  if (typeof data.orderId !== "string") return false;

  // Accept if it has either orderItems or orderItem
  const hasItems = Array.isArray(data.orderItems) || Array.isArray(data.orderItem);
  
  return hasItems;
};

// ── WebSocket Hook ───────────────────────────────────────
export const useOrderWebsocket = () => {
  const [isConnected, setIsConnected] = useState(false);
  const jwt = useAuthStore((state) => state.jwt);
  const shopId = useAuthStore((state) => state.shopId);
  const clearSession = useAuthStore((state) => state.clearSession);

  const addPendingOrder = useDashboardStore((state) => state.addPendingOrder);
  const upsertOrder = useDashboardStore((state) => state.upsertOrder);
  const removeOrder = useDashboardStore((state) => state.removeOrder);

  const clientRef = useRef<Client | null>(null);
  const expiryToastShownRef = useRef(false);

  useEffect(() => {
    if (!jwt || !shopId) {
      console.log("STOMP: Missing auth, skipping");
      return;
    }

    if (isTokenExpired(jwt)) {
      clearSession();
      return;
    }

    expiryToastShownRef.current = false;

    // Shared by onStompError/onWebSocketError: only a genuinely expired token should force a
    // logout + toast (risk R2 — a transient network blip must keep today's retry behaviour).
    const handlePossibleExpiry = () => {
      if (!isTokenExpired(jwt)) {
        setIsConnected(false);
        return;
      }
      if (expiryToastShownRef.current) return;
      expiryToastShownRef.current = true;
      clearSession();
      toast.error("Session expired - please log in again");
    };

    const client = new Client({
      webSocketFactory: () => new SockJS(baseurl + "/quickVerse/ws"), // 
      debug: (str) => console.log("STOMP:", str),
      reconnectDelay: 5000,
      connectHeaders: {
        Authorization: `Bearer ${jwt}`,
      },
      onConnect: () => {
        setIsConnected(true);
        console.log("✅ Connected to STOMP");

        const topic = `/topic/vendor/${shopId}`;
        console.log("📡 Subscribing to:", topic);

        client.subscribe(topic, (message) => {
          console.log("RAW message Received:", message.body);
          try {
            const data = JSON.parse(message.body);
            console.log("🔔 WebSocket Message received:", data);

            // 1. Handle Status Updates
            const currentStatus = data.status || data.state;
            // A phase moves the order into that column on every device; null means
            // terminal, unknown, or a brand new order (handled further down).
            const phase = normalisePhase(data.status ?? data.state);

            if (phase) {
              upsertOrder(data, phase);

              if (phase === "ACCEPTED") {
                toast.success(`${data.orderId} : Order Accepted`, {
                  icon: <CheckCircle className="text-emerald-500 w-6 h-6" />,
                  className: "bg-white text-black font-bold p-4 rounded-xl shadow-[0_4px_20px_rgba(16,185,129,0.15)] dark:bg-zinc-900 dark:text-white dark:shadow-[0_4px_20px_rgba(16,185,129,0.2)]",
                });
              }
              else if (phase === "READY_FOR_PICKUP") {
                toast.success(`${data.orderId} : Ready for Pickup`, {
                  icon: <Info className="text-blue-500 w-6 h-6" />,
                  className: "bg-white text-black font-bold p-4 rounded-xl shadow-[0_4px_20px_rgba(59,130,246,0.15)] dark:bg-zinc-900 dark:text-white",
                });
              }
            }
            else if (currentStatus === "REJECTED") {
              removeOrder(data.orderId);
              toast.error(`${data.orderId} : Order Rejected`, {
                icon: <XCircle className="text-rose-500 w-6 h-6" />,
                className: "bg-white text-black font-bold p-4 rounded-xl shadow-[0_4px_20px_rgba(0,0,0,0.15)] dark:bg-zinc-900 dark:text-white",
              });
            }
            else if (currentStatus === "CANCELLED") {
              removeOrder(data.orderId);
              toast.error(`Order #${data.orderId} was Cancelled by Customer`, {
                duration: 5000,
                position: "top-center",
                icon: <XCircle className="text-rose-500 w-6 h-6" />,
                className: "bg-white text-black font-bold p-4 rounded-xl shadow-[0_4px_20px_rgba(239,68,68,0.15)] dark:bg-zinc-900 dark:text-white",
              });
            }
            else if (currentStatus === "COMPLETED") {
              removeOrder(data.orderId);
              toast.success(`${data.orderId} : Order Handed Over to Rider`, {
                icon: <CheckCircle className="text-emerald-500 w-6 h-6" />,
                className: "bg-white text-black font-bold p-4 rounded-xl shadow-[0_4px_20px_rgba(16,185,129,0.15)] dark:bg-zinc-900 dark:text-white",
              });
            }

            else if (isValidOrder(data)) {
              console.log("➕ New Incoming Order added to grid:", data.orderId);
              addPendingOrder(data);
            }

          } catch (e) {
            console.error("WebSocket Parse error:", e);
          }
        });
      },

      onStompError: (frame) => {
        console.error("❌ STOMP error:", frame);
        handlePossibleExpiry();
      },

      onWebSocketError: (err) => {
        console.error("❌ WS error:", err);
        handlePossibleExpiry();
      },
    });

    client.activate();
    clientRef.current = client;

    // Catches a session that expires while the tab sits idle (no socket error to react to).
    const expiryCheckInterval = setInterval(() => {
      if (isTokenExpired(jwt)) {
        clearSession();
      }
    }, 60000);

    return () => {
      clearInterval(expiryCheckInterval);
      if (clientRef.current) {
        clientRef.current.deactivate();
        clientRef.current = null;
        console.log("❌ WebSocket Disconnected");
        setIsConnected(false);
      }
    };
  }, [jwt, shopId, addPendingOrder, upsertOrder, removeOrder, clearSession]);

  return isConnected;
};
