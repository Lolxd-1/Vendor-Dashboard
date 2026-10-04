// Self-pruning ledger over sessionStorage for the print/accept/ready flags.
// These vendor PCs run a Chrome --app kiosk shortcut that is never closed, so
// nothing ever clears these keys on its own and sessionStorage can eventually
// fill up. Every exported function here is TOTAL — it never throws to the
// caller — because moveToAccepted/moveToReady call into this from inside a
// zustand set() reducer with no try/catch of their own: a throw here would
// wedge Accept/Ready forever.

type StampKind = "acceptedAt" | "readyAt" | "acceptFailedAt";

// Legacy key names — unchanged, so data written before this ledger existed
// is still read correctly.
const printedKey = (orderId: string) => `qv_printed_${orderId}`;
const stampKey = (orderId: string, kind: StampKind) => `order_${orderId}_${kind}`;

const PRINTED_RE = /^qv_printed_(.+)$/;
const ACCEPTED_RE = /^order_(.+)_acceptedAt$/;
const READY_RE = /^order_(.+)_readyAt$/;
const ACCEPT_FAILED_RE = /^order_.+_acceptFailedAt$/;

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
      if (ACCEPT_FAILED_RE.test(key)) {
        stampEntries.push({ key, age: parseAge(safeGetItem(key)) });
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

// The printed flag is ALSO kept in localStorage, which every dashboard window on
// this PC shares. sessionStorage alone is per window: with two windows open (the
// Startup shortcut plus a click on the desktop icon), accepting the same order in
// the second one printed a second bill. The value is when it printed, so flags
// older than PRINTED_TTL_MS are pruned. Every access is total, like the rest.
export const PRINTED_TTL_MS = 2 * 24 * 60 * 60 * 1000;

const sharedGet = (key: string): string | null => {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
};

const sharedSet = (key: string, value: string): void => {
  try {
    localStorage.setItem(key, value);
  } catch {
    /* quota/blocked — the per-window flag still guards this window */
  }
};

const sharedRemove = (key: string): void => {
  try {
    localStorage.removeItem(key);
  } catch {
    /* ignore */
  }
};

// Drops shared printed flags older than PRINTED_TTL_MS (or unreadable). Never throws.
export const pruneSharedPrinted = (now = Date.now()): number => {
  try {
    const stale: string[] = [];
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i);
      if (!key || !PRINTED_RE.test(key)) continue;
      const t = Date.parse(localStorage.getItem(key) ?? "");
      if (Number.isNaN(t) || now - t > PRINTED_TTL_MS) stale.push(key);
    }
    stale.forEach(sharedRemove);
    return stale.length;
  } catch {
    return 0;
  }
};

// Idempotency: same order never double-prints on retry / re-render / 2nd window.
export const markPrinted = (orderId: string): void => {
  safeSetItem(printedKey(orderId), "1");
  sharedSet(printedKey(orderId), new Date().toISOString());
};

export const wasPrinted = (orderId: string): boolean => {
  return safeGetItem(printedKey(orderId)) === "1" || sharedGet(printedKey(orderId)) !== null;
};

// So the Reprint button can retry after a failed auto-print.
export const clearPrinted = (orderId: string): void => {
  safeRemoveItem(printedKey(orderId));
  sharedRemove(printedKey(orderId));
};

// Atomic test-and-set: false if this order was already claimed. Atomic because
// it is synchronous — JS runs it to completion before any other caller can
// observe the flag — which is exactly what check-then-act around an `await`
// is not: two accepts could both read `wasPrinted === false` and both print.
// (Across two windows it is test-and-set on shared storage: only two clicks
// within the same few milliseconds could both pass — not a human pattern.)
export const claimPrint = (orderId: string): boolean => {
  if (wasPrinted(orderId)) return false;
  markPrinted(orderId);
  return true;
};

// Give the claim back when nothing reached a printer, so Reprint can retry.
export const releasePrint = (orderId: string): void => {
  clearPrinted(orderId);
};

export const setOrderStamp = (orderId: string, kind: StampKind, iso: string): void => {
  safeSetItem(stampKey(orderId, kind), iso);
};

export const getOrderStamp = (orderId: string, kind: StampKind): string | null => {
  return safeGetItem(stampKey(orderId, kind));
};

// I10: this PC's accept call failed, but the backend may have committed it
// anyway — the next poll then files the order into Accepted with no bill and
// no KOT. The Accepted card reads this to show that nothing printed here.
export const markAcceptUnconfirmed = (orderId: string): void => {
  setOrderStamp(orderId, "acceptFailedAt", new Date().toISOString());
};

export const wasAcceptUnconfirmed = (orderId: string): boolean => {
  return getOrderStamp(orderId, "acceptFailedAt") !== null;
};
