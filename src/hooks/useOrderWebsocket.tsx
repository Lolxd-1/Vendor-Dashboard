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

// Raw STOMP frames include the CONNECT frame's `Authorization: Bearer <jwt>` header, so this
// must never run in a production build. import.meta.env.DEV is inlined at build time, so the
// branch (and the console.log call inside it) is dead code that gets dropped from the bundle.
export const stompDebug = (str: string) => {
  if (import.meta.env.DEV) {
    console.log("STOMP:", str);
  }
};

// `isConnected` is not evidence that orders arrive promptly: behind the Vercel rewrite proxy the
// STOMP client reports connected while SockJS is stuck on ~25s XHR long-polling. `lastMessageAt`
// is the delivery evidence — consumers decide how much to trust the socket from that, not from
// the connection flag.
export interface OrderSocketState {
  isConnected: boolean;
  lastMessageAt: number | null;   // epoch ms of the last PROMPT inbound frame (see isPromptFrame)
}

// How soon after an order is created a frame must arrive to count as prompt delivery.
export const PROMPT_MAX_MS = 5_000;

// Only a frame that arrived PROMPTLY is evidence the socket is healthy. Through the buffered
// Vercel long-poll every frame lands ~25-30s after the order was created, and counting that as
// evidence would earn the slow REST rate for the very socket that caused the latency.
//
// Fail-safe direction: a frame we cannot date — no `creationTime`, unparseable, or a clock so
// skewed the frame claims to be from well in the future — is NOT prompt, which keeps the fast
// REST rate. Degrading toward fast costs requests; degrading toward slow brings the bug back.
export const isPromptFrame = (data: unknown, now: number): boolean => {
  const creationTime = (data as { creationTime?: unknown } | null | undefined)?.creationTime;

  const t = Date.parse(String(creationTime));
  if (Number.isNaN(t)) return false;

  const age = now - t;
  if (age < -60_000) return false;   // more than a minute in the future: do not trust the stamp

  return age < PROMPT_MAX_MS;        // a small negative age is still fresh
};

// ── WebSocket Hook ───────────────────────────────────────
export const useOrderWebsocket = (): OrderSocketState => {
  const [isConnected, setIsConnected] = useState(false);
  const [lastMessageAt, setLastMessageAt] = useState<number | null>(null);
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
      if (import.meta.env.DEV) console.log("STOMP: Missing auth, skipping");
      return;
    }

    if (isTokenExpired(jwt)) {
      // Same once-only toast as the socket-error and idle-interval paths: a
      // vendor bounced to the login screen with no explanation cannot tell a
      // real expiry from a PC whose clock runs fast, and just logs in again.
      if (!expiryToastShownRef.current) {
        expiryToastShownRef.current = true;
        clearSession();
        toast.error("Session expired - please log in again");
      }
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
      debug: stompDebug,
      reconnectDelay: 5000,
      connectHeaders: {
        Authorization: `Bearer ${jwt}`,
      },
      onConnect: () => {
        setIsConnected(true);
        if (import.meta.env.DEV) console.log("✅ Connected to STOMP");

        const topic = `/topic/vendor/${shopId}`;
        if (import.meta.env.DEV) console.log("📡 Subscribing to:", topic);

        client.subscribe(topic, (message) => {
          try {
            const data = JSON.parse(message.body);

            // Stamped only for a frame that arrived promptly, so a late frame from a degraded
            // socket never earns the slow REST rate. A frame that fails to parse never gets here.
            const receivedAt = Date.now();
            if (isPromptFrame(data, receivedAt)) setLastMessageAt(receivedAt);

            // 1. Handle Status Updates
            const currentStatus = data.status || data.state;
            // A phase moves the order into that column on every device; null means
            // terminal, unknown, or a brand new order (handled further down).
            const phase = normalisePhase(data.status || data.state);

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
      if (!isTokenExpired(jwt)) return;
      if (expiryToastShownRef.current) return;
      expiryToastShownRef.current = true;
      clearSession();
      toast.error("Session expired - please log in again");
    }, 60000);

    return () => {
      clearInterval(expiryCheckInterval);
      if (clientRef.current) {
        clientRef.current.deactivate();
        clientRef.current = null;
        if (import.meta.env.DEV) console.log("❌ WebSocket Disconnected");
        setIsConnected(false);
      }
    };
  }, [jwt, shopId, addPendingOrder, upsertOrder, removeOrder, clearSession]);

  return { isConnected, lastMessageAt };
};
