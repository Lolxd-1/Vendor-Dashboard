import { create } from 'zustand';
import type { Order } from '../types/order';
import { getOrderStamp, pruneLedger, setOrderStamp } from '../utils/print/printLedger';

export type OrderPhase = "PENDING" | "ACCEPTED" | "READY_FOR_PICKUP";

// The socket sends the phase as `status`, the REST API as `state`. Anything that
// is not one of the three columns (terminal states, junk, non-strings) is null.
export const normalisePhase = (raw: unknown): OrderPhase | null => {
  if (typeof raw !== "string") return null;
  const phase = raw.trim().toUpperCase();
  return phase === "PENDING" || phase === "ACCEPTED" || phase === "READY_FOR_PICKUP"
    ? phase
    : null;
};

// States the server will never revive. useOrderWebsocket.tsx drops an order the
// instant its socket frame reports one of these — exported here so reconcile
// (the REST poll path) can match that exact set instead of drifting from it.
export const TERMINAL_STATES: ReadonlySet<string> = new Set(["REJECTED", "CANCELLED", "COMPLETED"]);

// Same normalisation as normalisePhase, so "cancelled" / " CANCELLED " still count.
export const isTerminalState = (raw: unknown): boolean =>
  typeof raw === "string" && TERMINAL_STATES.has(raw.trim().toUpperCase());

// Socket-driven moves are forward-only. A stale re-broadcast (a reconnect
// backfill, say) must never drag an already-ACCEPTED order back into Pending:
// pendingOrders.length would rise, the ring would restart and never stop, and
// staff could accept and print the same order twice.
const PHASE_RANK: Record<OrderPhase, number> = {
  PENDING: 0,
  ACCEPTED: 1,
  READY_FOR_PICKUP: 2,
};

// How long an order the socket delivered survives a REST poll that does not
// list it yet, because the backend has not indexed it (replication lag,
// read-replica delay, cache).
export const GRACE_MS = 120_000;

// Bookkeeping only, never sent to the backend: when the order entered this
// store. Used ONLY to decide whether a locally-known order is young enough to
// survive a server list that does not contain it.
export type StoredOrder = Order & { __receivedAt?: number };

interface DashboardState {
  pendingOrders: StoredOrder[];
  acceptedOrders: StoredOrder[];
  readyOrders: StoredOrder[];
  
  addPendingOrder: (order: Order) => void;
  reconcile: (serverOrders: Order[]) => void;
  setInitialOrders: (orders: Order[]) => void;
  upsertOrder: (order: Partial<Order> & { orderId: string }, phase: OrderPhase) => void;
  moveToAccepted: (orderId: string, preparationTime: number) => void;
  moveToReady: (orderId: string) => void;
  removeOrder: (orderId: string) => void;
  clearAll: () => void;
}

export const useDashboardStore = create<DashboardState>((set, get) => ({
  pendingOrders: [],
  acceptedOrders: [],
  readyOrders: [],

  // 1. MANUAL REFRESH / INITIAL LOAD / 45s POLL (REST API)
  // Reconciles with what the socket already delivered instead of replacing it:
  // an order that arrived seconds ago may not be in the REST payload yet, and
  // deleting it would empty pendingOrders, stop the ring, and lose the order.
  // Smart-merge: preserves locally-set readyDate/acceptedDate/preparationTime
  // so timers don't reset when the API returns them as null after a poll.
  reconcile: (serverOrders) => set((state) => {
    // A failed or malformed poll carries no information — it must never wipe
    // the board, so treat anything that is not a list as "no news".
    if (!Array.isArray(serverOrders)) return state;

    // Housekeeping on the normal refresh path — no timer needed.
    pruneLedger();

    // Build a flat lookup of all orders currently in the store
    const allExisting = [
      ...state.pendingOrders,
      ...state.acceptedOrders,
      ...state.readyOrders,
    ];

    const now = Date.now();

    // Where this client currently holds each order, so a poll can be weighed
    // against what we already know instead of believed on sight.
    const localPhase = new Map<string, OrderPhase>();
    for (const o of state.pendingOrders) localPhase.set(o.orderId, "PENDING");
    for (const o of state.acceptedOrders) localPhase.set(o.orderId, "ACCEPTED");
    for (const o of state.readyOrders) localPhase.set(o.orderId, "READY_FOR_PICKUP");

    // This client moved the order forward and stamped the moment it did. While
    // that stamp is fresh, a poll reporting an EARLIER phase is far more likely
    // replica lag than a genuine revert — and acting on it restarts the ring,
    // re-fires the notification, resets the prep timer, and invites a vendor to
    // reject an order the kitchen is already cooking.
    const movedHereRecently = (orderId: string, phase: OrderPhase): boolean => {
      if (phase === "PENDING") return false;
      const iso = getOrderStamp(orderId, phase === "ACCEPTED" ? "acceptedAt" : "readyAt");
      const stampedAt = iso ? Date.parse(iso) : NaN;
      return !Number.isNaN(stampedAt) && now - stampedAt < GRACE_MS;
    };

    // The column a listed order belongs in. Phase strings cannot be trusted, so
    // this goes through normalisePhase like every other path. null means the
    // server's value names none of the three columns, so this poll carries no
    // news about that order at all.
    const phaseOf = (o: Order): OrderPhase | null => {
      const serverPhase = normalisePhase(o.state);
      if (serverPhase === null) return null;
      const local = localPhase.get(o.orderId);
      if (local && PHASE_RANK[serverPhase] < PHASE_RANK[local] && movedHereRecently(o.orderId, local)) {
        return local;
      }
      return serverPhase;
    };

    const smartMerge = (incoming: Order, phase: OrderPhase): StoredOrder => {
      const existing = allExisting.find(e => e.orderId === incoming.orderId);

      // sessionStorage timestamps are the most reliable — set by the client
      // at the exact moment of moveToAccepted/moveToReady, in UTC with Z.
      const sessionAcceptedDate = getOrderStamp(incoming.orderId, "acceptedAt");
      const sessionReadyDate    = getOrderStamp(incoming.orderId, "readyAt");

      return {
        ...incoming,
        // The columns bucket on `state`, so the phase this poll resolved wins.
        state:           phase,
        // Priority: sessionStorage > local store > API value
        acceptedDate:    sessionAcceptedDate || existing?.acceptedDate    || incoming.acceptedDate,
        readyDate:       sessionReadyDate    || existing?.readyDate       || incoming.readyDate,
        preparationTime: existing?.preparationTime || incoming.preparationTime,
        // "Last time we had evidence this order exists", NOT "when it first
        // arrived": the server just listed it, so that evidence is now. Anchored
        // to first receipt instead, any order on the board longer than GRACE_MS
        // was deleted by the first poll that happened to omit it.
        __receivedAt:    now,
      };
    };

    // Resolved once per listed order: phaseOf reads sessionStorage, and the poll
    // runs every 10s.
    const listed = serverOrders.map(o => ({ order: o, phase: phaseOf(o) }));

    // "The server has an opinion about this" means either of two things: this
    // poll placed it in a column, OR it reported a KNOWN terminal status
    // (REJECTED/CANCELLED/COMPLETED) — gone for good, same as BASE dropped it.
    // Only a state that is neither — genuinely unrecognised — is no news, so
    // the local copy keeps its grace window rather than being deleted on the
    // spot or, just as bad, kept forever.
    const serverIds = new Set(
      listed
        .filter(l => l.phase !== null || isTerminalState(l.order.state))
        .map(l => l.order.orderId)
    );

    const inColumn = (phase: OrderPhase) =>
      listed.filter(l => l.phase === phase).map(l => smartMerge(l.order, phase));

    // Absent from the server list: keep it only while it is young enough that
    // the backend has plausibly not indexed it yet. A poll that lists the order
    // as a KNOWN terminal status is not "absent" — serverIds already covers it
    // above, so it drops on this same poll, exactly like a socket CANCELLED.
    // Only a status nothing above recognises gets this grace window at all.
    const survivors = (list: StoredOrder[]) =>
      list
        .filter(o => !serverIds.has(o.orderId))
        // An order that somehow carries no stamp gets one now — a full window
        // rather than the zero grace an undefined stamp used to mean.
        .map(o => ({ ...o, __receivedAt: o.__receivedAt ?? now }))
        .filter(o => now - o.__receivedAt < GRACE_MS);

    // Server-derived orders keep their server order, survivors are appended,
    // so cards do not jump around between polls.
    return {
      pendingOrders:  [...inColumn("PENDING"),          ...survivors(state.pendingOrders)],
      acceptedOrders: [...inColumn("ACCEPTED"),         ...survivors(state.acceptedOrders)],
      readyOrders:    [...inColumn("READY_FOR_PICKUP"), ...survivors(state.readyOrders)],
    };
  }),

  // Kept so existing callers keep working — the REST entry point is reconcile.
  setInitialOrders: (orders) => get().reconcile(orders),

  // 2. WEBSOCKET INCOMING
  addPendingOrder: (order) => set((state) => {
    const exists = 
      state.pendingOrders.some(o => o.orderId === order.orderId) ||
      state.acceptedOrders.some(o => o.orderId === order.orderId) ||
      state.readyOrders.some(o => o.orderId === order.orderId);
      
    if (exists) return state;
    
    // Naya order hamesha PENDING me jayega
    const newOrder: StoredOrder = { ...order, state: "PENDING", __receivedAt: Date.now() };
    return { pendingOrders: [...state.pendingOrders, newOrder] };
  }),

  // A phase change from another device: merge the fields AND move the order into
  // the column the phase names. updateOrder only merges, so it never moves.
  upsertOrder: (order, phase) => set((state) => {
    const { orderId } = order;
    const inPending  = state.pendingOrders.find(o => o.orderId === orderId);
    const inAccepted = state.acceptedOrders.find(o => o.orderId === orderId);
    const inReady    = state.readyOrders.find(o => o.orderId === orderId);
    const existing   = inPending ?? inAccepted ?? inReady;

    const currentPhase: OrderPhase | null =
      inPending ? "PENDING" : inAccepted ? "ACCEPTED" : inReady ? "READY_FOR_PICKUP" : null;

    // Forward-only for an order we already hold: ignore a move to a lower rank.
    // Inserting a brand-new order at any phase is still allowed, and reconcile
    // is exempt because the REST list is authoritative and must be able to
    // correct a genuine server-side revert.
    if (currentPhase !== null && PHASE_RANK[phase] < PHASE_RANK[currentPhase]) return state;

    // setInitialOrders and the columns bucket on `state`, so the phase wins.
    const merged = {
      ...existing,
      ...order,
      state: phase,
      __receivedAt: existing?.__receivedAt ?? Date.now(),
    } as StoredOrder;

    // Already in the target column: merge in place so a repeated same-phase
    // message does not send the card to the bottom of its column.
    const intoTarget = (list: StoredOrder[]) =>
      currentPhase === phase
        ? list.map(o => (o.orderId === orderId ? merged : o))
        : [...list, merged];
    const without = (list: StoredOrder[]) => list.filter(o => o.orderId !== orderId);

    return {
      pendingOrders:  phase === "PENDING"          ? intoTarget(state.pendingOrders)  : without(state.pendingOrders),
      acceptedOrders: phase === "ACCEPTED"         ? intoTarget(state.acceptedOrders) : without(state.acceptedOrders),
      readyOrders:    phase === "READY_FOR_PICKUP" ? intoTarget(state.readyOrders)    : without(state.readyOrders),
    };
  }),

  moveToAccepted: (orderId, preparationTime) => set((state) => {
    const orderIndex = state.pendingOrders.findIndex(o => o.orderId === orderId);
    if (orderIndex === -1) return state; 
    
    const now = new Date().toISOString(); // UTC with Z — reliable reference
    setOrderStamp(orderId, "acceptedAt", now); // survives page reload

    const order = state.pendingOrders[orderIndex];
    const acceptedOrder: Order = { 
      ...order, 
      state: "ACCEPTED",
      preparationTime,
      acceptedDate: now
    };
    
    return {
      pendingOrders: state.pendingOrders.filter(o => o.orderId !== orderId),
      acceptedOrders: [...state.acceptedOrders, acceptedOrder]
    };
  }),

  moveToReady: (orderId) => set((state) => {
    const orderIndex = state.acceptedOrders.findIndex(o => o.orderId === orderId);
    if (orderIndex === -1) return state; 
    
    const now = new Date().toISOString(); // UTC with Z — reliable reference
    setOrderStamp(orderId, "readyAt", now); // survives page reload

    const order = state.acceptedOrders[orderIndex];
    const readyOrder: Order = { 
      ...order, 
      state: "READY_FOR_PICKUP",
      readyDate: now
    };
    
    return {
      acceptedOrders: state.acceptedOrders.filter(o => o.orderId !== orderId),
      readyOrders: [...state.readyOrders, readyOrder]
    };
  }),

  removeOrder: (orderId) => set((state) => ({
    pendingOrders: state.pendingOrders.filter(o => o.orderId !== orderId),
    acceptedOrders: state.acceptedOrders.filter(o => o.orderId !== orderId),
    readyOrders: state.readyOrders.filter(o => o.orderId !== orderId),
  })),

  clearAll: () => set({
    pendingOrders: [],
    acceptedOrders: [],
    readyOrders: []
  })
}));