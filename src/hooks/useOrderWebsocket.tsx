import { Client } from "@stomp/stompjs";
import { CheckCircle, Info, XCircle } from 'lucide-react';
import { useEffect, useRef, useState } from "react";
import { toast } from 'react-hot-toast';
import SockJS from "sockjs-client";
import { baseurl } from "../apis";
import { useAuthStore } from "../stores/useAuthStore";
import { useDashboardStore } from "../stores/useDashboardStore";

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

  const addPendingOrder = useDashboardStore((state) => state.addPendingOrder);
  const updateOrder = useDashboardStore((state) => state.updateOrder);
  const removeOrder = useDashboardStore((state) => state.removeOrder);

  const clientRef = useRef<Client | null>(null);

  useEffect(() => {
    if (!jwt || !shopId) {
      console.log("STOMP: Missing auth, skipping");
      return;
    }

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

            if (currentStatus === "ACCEPTED") {
              // Now we keep it on screen, just update the status so the DashboardStore handles it properly
              // Note: Usually the frontend moves it, but if another client (or this client) accepts it,
              // we get the websocket message. We can update it in the store if it has all info.
              // If it's just { orderId, status }, it might not have enough info to show in Accepted.
              // For now we'll just update it if we have it. If it comes from backend as a full object, we add it.
              if (isValidOrder(data)) {
                // Add to accepted (will be handled by store if we manually dispatch it or we can just update it)
                // The best way is to let the frontend logic move it on button click, 
                // and use WS for syncing across multiple devices.
                updateOrder(data.orderId, data);
              } else {
                updateOrder(data.orderId, { status: "ACCEPTED", ...data });
              }

              toast.success(`${data.orderId} : Order Accepted`, {
                icon: <CheckCircle className="text-emerald-500 w-6 h-6" />,
                className: "bg-white text-black font-bold p-4 rounded-xl shadow-[0_4px_20px_rgba(16,185,129,0.15)] dark:bg-zinc-900 dark:text-white dark:shadow-[0_4px_20px_rgba(16,185,129,0.2)]",
              });
            }
            else if (currentStatus === "READY_FOR_PICKUP") {
              updateOrder(data.orderId, { status: "READY_FOR_PICKUP", ...data });
              toast.success(`${data.orderId} : Ready for Pickup`, {
                icon: <Info className="text-blue-500 w-6 h-6" />,
                className: "bg-white text-black font-bold p-4 rounded-xl shadow-[0_4px_20px_rgba(59,130,246,0.15)] dark:bg-zinc-900 dark:text-white",
              });
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
        setIsConnected(false);
      },

      onWebSocketError: (err) => {
        console.error("❌ WS error:", err);
        setIsConnected(false);
      },
    });

    client.activate();
    clientRef.current = client;

    return () => {
      if (clientRef.current) {
        clientRef.current.deactivate();
        clientRef.current = null;
        console.log("❌ WebSocket Disconnected");
        setIsConnected(false);
      }
    };
  }, [jwt, shopId, addPendingOrder, updateOrder, removeOrder]);

  return isConnected;
};
