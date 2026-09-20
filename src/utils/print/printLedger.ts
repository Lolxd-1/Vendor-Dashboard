// Self-pruning ledger over sessionStorage for the print/accept/ready flags.
// These vendor PCs run a Chrome --app kiosk shortcut that is never closed, so
// nothing ever clears these keys on its own and sessionStorage can eventually
// fill up. Every exported function here is TOTAL — it never throws to the
// caller — because moveToAccepted/moveToReady call into this from inside a
// zustand set() reducer with no try/catch of their own: a throw here would
// wedge Accept/Ready forever.

type StampKind = "acceptedAt" | "readyAt";

// Legacy key names — unchanged, so data written before this ledger existed
// is still read correctly.
const printedKey = (orderId: string) => `qv_printed_${orderId}`;
const stampKey = (orderId: string, kind: StampKind) => `order_${orderId}_${kind}`;

const PRINTED_RE = /^qv_printed_(.+)$/;
const ACCEPTED_RE = /^order_(.+)_acceptedAt$/;
const READY_RE = /^order_(.+)_readyAt$/;

const safeGetItem = (key: string): string | null => {
  try {
    return sessionStorage.getItem(key);
  } catch {
    return null;
  }
};

const safeRemoveItem = (key: string): void => {
  try {
    sessionStorage.removeItem(key);
  } catch {
    /* ignore */
  }
};

const collectKeys = (): string[] => {
  const keys: string[] = [];
  try {
    for (let i = 0; i < sessionStorage.length; i++) {
      const key = sessionStorage.key(i);
      if (key) keys.push(key);
    }
  } catch {
    return [];
  }
  return keys;
};

// Oldest-first age. A missing/unparseable stamp sorts as the oldest possible
// entry so garbage never survives a prune ahead of real data.
const parseAge = (value: string | null): number => {
  if (!value) return -Infinity;
  const t = Date.parse(value);
  return Number.isNaN(t) ? -Infinity : t;
};

// Removes the oldest ledger entries once the three key families together
// exceed maxEntries. A qv_printed_<id> key (which stores only "1") borrows
// its order's acceptedAt/readyAt age; when neither stamp exists for it, it is
// an orphaned flag and is removed before any entry that does have an age.
// Never removes more than necessary. Never throws.
export const pruneLedger = (maxEntries = 400): number => {
  try {
    const acceptedAgeByOrder = new Map<string, number>();
    const readyAgeByOrder = new Map<string, number>();
    const stampEntries: { key: string; age: number }[] = [];
    const printedIds: { key: string; orderId: string }[] = [];

    for (const key of collectKeys()) {
      const accepted = ACCEPTED_RE.exec(key);
      if (accepted) {
        const age = parseAge(safeGetItem(key));
        acceptedAgeByOrder.set(accepted[1], age);
        stampEntries.push({ key, age });
        continue;
      }
      const ready = READY_RE.exec(key);
      if (ready) {
        const age = parseAge(safeGetItem(key));
        readyAgeByOrder.set(ready[1], age);
        stampEntries.push({ key, age });
        continue;
      }
      const printed = PRINTED_RE.exec(key);
      if (printed) printedIds.push({ key, orderId: printed[1] });
    }

    const printedEntries = printedIds.map(({ key, orderId }) => ({
      key,
      age: acceptedAgeByOrder.get(orderId) ?? readyAgeByOrder.get(orderId) ?? -Infinity,
    }));

    const entries = [...stampEntries, ...printedEntries];
    const excess = entries.length - maxEntries;
    if (excess <= 0) return 0;

    entries.sort((a, b) => (a.age < b.age ? -1 : a.age > b.age ? 1 : 0));
    for (const entry of entries.slice(0, excess)) {
      safeRemoveItem(entry.key);
    }
    return excess;
  } catch {
    return 0;
  }
};

// A write that hits QuotaExceededError prunes the ledger once and retries
// once; if it still fails, the value is silently dropped. Losing a timestamp
// or print flag is acceptable — wedging the dashboard is not.
const safeSetItem = (key: string, value: string): void => {
  try {
    sessionStorage.setItem(key, value);
    return;
  } catch {
    /* storage full — fall through to prune + retry */
  }
  pruneLedger();
  try {
    sessionStorage.setItem(key, value);
  } catch {
    /* still failing after a prune — give up silently */
  }
};

// Idempotency: same order never double-prints on retry / re-render.
export const markPrinted = (orderId: string): void => {
  safeSetItem(printedKey(orderId), "1");
};

export const wasPrinted = (orderId: string): boolean => {
  return safeGetItem(printedKey(orderId)) === "1";
};

// So the Reprint button can retry after a failed auto-print.
export const clearPrinted = (orderId: string): void => {
  safeRemoveItem(printedKey(orderId));
};

export const setOrderStamp = (orderId: string, kind: StampKind, iso: string): void => {
  safeSetItem(stampKey(orderId, kind), iso);
};

export const getOrderStamp = (orderId: string, kind: StampKind): string | null => {
  return safeGetItem(stampKey(orderId, kind));
};
