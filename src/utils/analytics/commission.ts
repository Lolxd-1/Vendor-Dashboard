// QuickVerse commission (10% for most vendors, 5% for some). Until the backend sends it,
// the vendor sets it on the Analytics page; it is remembered per shop on this device and
// only changes what the page shows, never a real payout.

export const DEFAULT_COMMISSION_PCT = 10;

const storageKey = (shopId: string | null) => `qv_commission_pct:${shopId ?? ""}`;

// EPSILON so 1.005 rounds to 1.01 like a person would expect, not 1.00.
export const round2 = (n: number): number => Math.round((n + Number.EPSILON) * 100) / 100;

export const commissionOf = (gross: number, pct: number): number => round2((gross * pct) / 100);

export const isValidCommissionPct = (pct: number): boolean => Number.isFinite(pct) && pct >= 0 && pct <= 100;

export const loadCommissionPct = (shopId: string | null): number => {
  try {
    const raw = localStorage.getItem(storageKey(shopId));
    if (raw === null || raw.trim() === "") return DEFAULT_COMMISSION_PCT;
    const pct = Number(raw);
    return isValidCommissionPct(pct) ? pct : DEFAULT_COMMISSION_PCT;
  } catch {
    return DEFAULT_COMMISSION_PCT;
  }
};

export const saveCommissionPct = (shopId: string | null, pct: number): boolean => {
  if (!isValidCommissionPct(pct)) return false;
  try {
    localStorage.setItem(storageKey(shopId), String(pct));
    return true;
  } catch {
    return false;
  }
};
