// Print bridge: tries the tiny local agent first (silent, no popup,
// correct printer by name, shares Windows queue with PetPooja).
// Falls back to browser print (80mm window) if agent is not installed.

export interface PrinterSettings {
  counterPrinter: string;
  kitchenPrinter: string;
  agentPort: number;
}

export const DEFAULT_PRINTERS: PrinterSettings = {
  // Single-printer default for pilot: same 80mm queue prints Bill+KOT back-to-back.
  // Shops with 2 printers change kitchen to the 2nd queue name later — no code change.
  counterPrinter: "EPSON TM-T82X Receipt",
  kitchenPrinter: "EPSON TM-T82X Receipt",
  agentPort: 1818,
};

export const REQUIRED_AGENT_VERSION = "1.3.2";

// exp1: real vs virtual queue detection.
// Agent v1.3 returns { printers, real, detail }. Older agents return only { printers }.
// Client fallback uses the same blocklist so old agents still filter correctly.
// Keep in sync with print-agent/agent.ps1 Test-IsVirtualPrinter + server.js isVirtualPrinter().
export interface PrinterInfo {
  name: string;
  driver?: string;
  port?: string;
  isVirtual: boolean;
}

const VIRTUAL_NAME_RE =
  /Microsoft Print to PDF|Microsoft XPS|OneNote|Fax|Adobe PDF|CutePDF|PDFCreator|Bullzip|PrimoPDF|Print to File|Snagit|Snip & Sketch|XPS Document Writer/i;
const VIRTUAL_DRIVER_RE =
  /Microsoft Print To PDF|Microsoft XPS|OneNote|Fax|Adobe PDF|CutePDF|PDFCreator|Bullzip|PrimoPDF/i;
const VIRTUAL_PORT_RE = /^(PORTPROMPT:|SHR:|FILE:|NUL:|XpsPort:|Ne0)/i;

export const isVirtualPrinter = (name: string, driver = "", port = ""): boolean => {
  if (VIRTUAL_NAME_RE.test(name || "")) return true;
  if (driver && VIRTUAL_DRIVER_RE.test(driver)) return true;
  if (port && VIRTUAL_PORT_RE.test(port)) return true;
  return false;
};

export const getShowAllPrinters = (): boolean => {
  try {
    return localStorage.getItem("qv_show_all_printers") === "1";
  } catch {
    return false;
  }
};

export const setShowAllPrinters = (v: boolean) => {
  try {
    localStorage.setItem("qv_show_all_printers", v ? "1" : "0");
  } catch {
    /* ignore */
  }
};

export const getAgentPrinterDetails = async (): Promise<PrinterInfo[]> => {
  const { agentPort } = getPrinterSettings();
  try {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), 2000);
    const res = await fetch(`http://127.0.0.1:${agentPort}/printers`, { signal: ctrl.signal });
    clearTimeout(t);
    if (!res.ok) return [];
    const data = await res.json();
    // Preferred: rich detail from agent v1.3+
    if (Array.isArray(data?.detail)) {
      return (data.detail as any[])
        .filter((d) => typeof d?.name === "string" && d.name.trim())
        .map((d) => ({
          name: String(d.name),
          driver: typeof d.driver === "string" ? d.driver : "",
          port: typeof d.port === "string" ? d.port : "",
          isVirtual:
            typeof d.isVirtual === "boolean"
              ? d.isVirtual
              : isVirtualPrinter(String(d.name), String(d.driver || ""), String(d.port || "")),
        }));
    }
    // Fallback: name-only list (agent <= 1.2) — classify client-side.
    // Prefer `real` field if present, else classify each name.
    const names: string[] = Array.isArray(data?.printers) ? data.printers : [];
    const realSet = new Set(Array.isArray(data?.real) ? data.real : []);
    return names.map((name) => ({
      name: String(name),
      driver: "",
      port: "",
      isVirtual: realSet.size ? !realSet.has(name) : isVirtualPrinter(String(name)),
    }));
  } catch {
    return [];
  }
};

export const getRealPrinterNames = (detail: PrinterInfo[]): string[] =>
  detail.filter((d) => !d.isVirtual).map((d) => d.name);

export const getAgentVersion = async (): Promise<string | null> => {
  const { agentPort } = getPrinterSettings();
  try {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), 1500);
    const res = await fetch(`http://127.0.0.1:${agentPort}/status`, { signal: ctrl.signal });
    clearTimeout(t);
    if (!res.ok) return null;
    const data = await res.json();
    return typeof data?.version === "string" ? data.version : null;
  } catch {
    return null;
  }
};

export const getPrinterSettings = (): PrinterSettings => {
  try {
    return {
      counterPrinter: localStorage.getItem("qv_counter_printer") || DEFAULT_PRINTERS.counterPrinter,
      kitchenPrinter: localStorage.getItem("qv_kitchen_printer") || DEFAULT_PRINTERS.kitchenPrinter,
      agentPort: Number(localStorage.getItem("qv_agent_port")) || DEFAULT_PRINTERS.agentPort,
    };
  } catch {
    return DEFAULT_PRINTERS;
  }
};

export const savePrinterSettings = (s: PrinterSettings) => {
  localStorage.setItem("qv_counter_printer", s.counterPrinter);
  localStorage.setItem("qv_kitchen_printer", s.kitchenPrinter);
  localStorage.setItem("qv_agent_port", String(s.agentPort));
};

const agentUrl = (port: number) => `http://127.0.0.1:${port}/print`;

// exp2: honest errors. Agent HTTP 200 = handed to Windows spooler (not paper-out).
// Non-200 body (e.g. "print failed: Printer not found: X") is surfaced so the
// toast can say WHY instead of a lying "Sent to printer".
export interface AgentPrintResult {
  ok: boolean;
  error?: string;
}

export const printViaAgentDetailed = async (printer: string, text: string): Promise<AgentPrintResult> => {
  const { agentPort } = getPrinterSettings();
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), 2500);
  try {
    const res = await fetch(agentUrl(agentPort), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ printer, text }),
      signal: ctrl.signal,
    });
    if (res.ok) return { ok: true };
    let body = "";
    try {
      body = (await res.text()).trim().slice(0, 300);
    } catch {
      /* ignore */
    }
    return { ok: false, error: body || `helper replied ${res.status}` };
  } catch {
    return { ok: false, error: "helper unreachable — is print-agent running on THIS pc?" };
  } finally {
    clearTimeout(t);
  }
};

export const checkAgentOnline = async (): Promise<boolean> => {
  const { agentPort } = getPrinterSettings();
  try {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), 1500);
    const res = await fetch(`http://127.0.0.1:${agentPort}/status`, { signal: ctrl.signal });
    clearTimeout(t);
    return res.ok;
  } catch {
    return false;
  }
};

// Fallback path — 80mm browser window. Staff picks printer once,
// ticks "remember", then it is 1 click. Used only if agent not installed.
export const printViaBrowser = (title: string, text: string) => {
  const w = window.open("", "_blank", "width=320,height=600");
  if (!w) return false;
  const esc = text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  w.document.write(`<html><head><title>${title}</title><style>
    @page { size: 80mm auto; margin: 0; }
    body { width: 80mm; margin: 0; padding: 4mm; font-family: monospace; font-size: 12px; white-space: pre-wrap; color: #000; }
  </style></head><body>${esc}<scr` + `ipt>window.onload=()=>{window.print();}</scr` + `ipt></body></html>`);
  w.document.close();
  return true;
};

// Tries agent, falls back to browser. Returns where it printed + why it failed.
// exp2: callers MUST branch on `where` — never toast success on "failed".
export type PrintWhere = "agent" | "browser" | "failed";

export interface PrintOutcome {
  where: PrintWhere;
  printer: string;
  error?: string;
}

export const printTextDetailed = async (
  kind: "counter" | "kitchen",
  text: string
): Promise<PrintOutcome> => {
  const s = getPrinterSettings();
  const printer = kind === "counter" ? s.counterPrinter : s.kitchenPrinter;
  const r = await printViaAgentDetailed(printer, text);
  if (r.ok) return { where: "agent", printer };
  // Agent reachable but refused (wrong queue name, spooler error) → do NOT
  // silently fall back to browser; surface the reason so staff fixes the queue.
  // Only fall back when the helper itself is unreachable (not installed).
  const unreachable = /unreachable|failed to fetch|aborted|network/i.test(r.error || "");
  if (!unreachable) return { where: "failed", printer, error: r.error };
  const opened = printViaBrowser(kind === "counter" ? "QuickVerse Bill" : "QuickVerse KOT", text);
  return opened ? { where: "browser", printer } : { where: "failed", printer, error: r.error };
};

// exp2: spooler truth. Agent 1.3.0-exp2+ serves GET /queue:
// { queues: [{ name, status, jobs, hasError, errorText }] }.
// Older agents 404 → returns [] (callers treat as unknown, not error).
export interface QueueInfo {
  name: string;
  status: string;
  jobs: number;
  hasError: boolean;
  errorText?: string;
}

export const getAgentQueue = async (): Promise<QueueInfo[]> => {
  const { agentPort } = getPrinterSettings();
  try {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), 2500);
    const res = await fetch(`http://127.0.0.1:${agentPort}/queue`, { signal: ctrl.signal });
    clearTimeout(t);
    if (!res.ok) return [];
    const data = await res.json();
    if (!Array.isArray(data?.queues)) return [];
    return (data.queues as any[])
      .filter((q) => typeof q?.name === "string" && q.name.trim())
      .map((q) => ({
        name: String(q.name),
        status: typeof q.status === "string" ? q.status : "",
        jobs: Number(q.jobs) || 0,
        hasError: q.hasError === true,
        errorText: typeof q.errorText === "string" ? q.errorText : "",
      }));
  } catch {
    return [];
  }
};
