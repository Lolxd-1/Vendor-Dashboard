// Print bridge: tries the tiny local agent first (silent, no popup,
// correct printer by name, shares Windows queue with PetPooja).
// Falls back to browser print (80mm window) if agent is not installed.

export interface PrinterSettings {
  counterPrinter: string;
  kitchenPrinter: string;
  agentPort: number;
}

export const DEFAULT_PRINTERS: PrinterSettings = {
  counterPrinter: "EPSON TM-T82 Receipt",
  kitchenPrinter: "TVSE RP3200 Lite",
  agentPort: 1818,
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

// Silent path — agent writes to the named Windows printer via spooler,
// so PetPooja jobs and ours line up one after other, never half-mixed.
export const printViaAgent = async (printer: string, text: string): Promise<boolean> => {
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
    return res.ok;
  } catch {
    return false;
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

// Tries agent, falls back to browser. Returns where it printed.
export const printText = async (kind: "counter" | "kitchen", text: string): Promise<"agent" | "browser" | "failed"> => {
  const s = getPrinterSettings();
  const printer = kind === "counter" ? s.counterPrinter : s.kitchenPrinter;
  const ok = await printViaAgent(printer, text);
  if (ok) return "agent";
  const opened = printViaBrowser(kind === "counter" ? "QuickVerse Bill" : "QuickVerse KOT", text);
  return opened ? "browser" : "failed";
};
