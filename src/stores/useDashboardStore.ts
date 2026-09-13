import { create } from 'zustand';
import type { Order } from '../types/order';

interface DashboardState {
  pendingOrders: Order[];
  acceptedOrders: Order[];
  readyOrders: Order[];
  
  addPendingOrder: (order: Order) => void;
  setInitialOrders: (orders: Order[]) => void;
  updateOrder: (orderId: string, updates: Partial<Order>) => void;
  moveToAccepted: (orderId: string, preparationTime: number) => void;
  moveToReady: (orderId: string) => void;
  removeOrder: (orderId: string) => void;
  clearAll: () => void;
}

export const useDashboardStore = create<DashboardState>((set) => ({
  pendingOrders: [],
  acceptedOrders: [],
  readyOrders: [],

  // 1. MANUAL REFRESH / INITIAL LOAD (REST API)
  // Smart-merge: preserves locally-set readyDate/acceptedDate/preparationTime
  // so timers don't reset when the API returns them as null after a poll.
  setInitialOrders: (orders) => set((state) => {
    // Build a flat lookup of all orders currently in the store
    const allExisting = [
      ...state.pendingOrders,
      ...state.acceptedOrders,
      ...state.readyOrders,
    ];

    const smartMerge = (incoming: Order): Order => {
      const existing = allExisting.find(e => e.orderId === incoming.orderId);
      
      // sessionStorage timestamps are the most reliable — set by the client
      // at the exact moment of moveToAccepted/moveToReady, in UTC with Z.
      const sessionAcceptedDate = sessionStorage.getItem(`order_${incoming.orderId}_acceptedAt`);
      const sessionReadyDate    = sessionStorage.getItem(`order_${incoming.orderId}_readyAt`);

      return {
        ...incoming,
        // Priority: sessionStorage > local store > API value
        acceptedDate:    sessionAcceptedDate || existing?.acceptedDate    || incoming.acceptedDate,
        readyDate:       sessionReadyDate    || existing?.readyDate       || incoming.readyDate,
        preparationTime: existing?.preparationTime || incoming.preparationTime,
      };
    };

    return {
      pendingOrders:  orders.filter(o => o.state === "PENDING").map(smartMerge),
      acceptedOrders: orders.filter(o => o.state === "ACCEPTED").map(smartMerge),
      readyOrders:    orders.filter(o => o.state === "READY_FOR_PICKUP").map(smartMerge),
    };
  }),

  // 2. WEBSOCKET INCOMING
  addPendingOrder: (order) => set((state) => {
    const exists = 
      state.pendingOrders.some(o => o.orderId === order.orderId) ||
      state.acceptedOrders.some(o => o.orderId === order.orderId) ||
      state.readyOrders.some(o => o.orderId === order.orderId);
      
    if (exists) return state;
    
    // Naya order hamesha PENDING me jayega
    const newOrder: Order = { ...order, state: "PENDING" };
    return { pendingOrders: [...state.pendingOrders, newOrder] };
  }),

  updateOrder: (orderId, updates) => set((state) => ({
    pendingOrders: state.pendingOrders.map(o => o.orderId === orderId ? { ...o, ...updates } : o),
    acceptedOrders: state.acceptedOrders.map(o => o.orderId === orderId ? { ...o, ...updates } : o),
    readyOrders: state.readyOrders.map(o => o.orderId === orderId ? { ...o, ...updates } : o),
  })),

  moveToAccepted: (orderId, preparationTime) => set((state) => {
    const orderIndex = state.pendingOrders.findIndex(o => o.orderId === orderId);
    if (orderIndex === -1) return state; 
    
    const now = new Date().toISOString(); // UTC with Z — reliable reference
    sessionStorage.setItem(`order_${orderId}_acceptedAt`, now); // survives page reload

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
    sessionStorage.setItem(`order_${orderId}_readyAt`, now); // survives page reload

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