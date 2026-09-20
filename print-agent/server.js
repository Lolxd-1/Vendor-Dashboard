// QuickVerse Print Agent — runs on the billing PC where USB printers are plugged.
// No npm deps. Uses Windows PowerShell Out-Printer so jobs share the same
// spooler queue PetPooja uses: first-in-first-out, never half-mixed.
//
// Install: node server.js  (auto-starts via Task Scheduler / Startup folder)
// Dashboard calls: POST http://127.0.0.1:1818/print  { printer, text }
// Binds 127.0.0.1 only — unreachable from network.

const http = require("http");
const { exec } = require("child_process");
const fs = require("fs");
const os = require("os");
const path = require("path");

const PORT = process.env.QV_AGENT_PORT || 1818;

function buildRawEscPos(text) {
  // Kept for fallback — ESC @ + ASCII + feed + partial cut. Used only if GDI fails.
  const clean = String(text || "").replace(/[^\x09\x0A\x0D\x20-\x7E]/g, "?");
  const body = clean.replace(/\r?\n/g, "\n") + "\n\n\n\n";
  const head = Buffer.from([0x1b, 0x40]);
  const tail = Buffer.from([0x1d, 0x56, 0x01]);
  return Buffer.concat([head, Buffer.from(body, "ascii"), tail]);
}

function sendGdiToWindowsPrinter(printerName, text, cb) {
  // GDI via System.Drawing.PrintDocument + Courier New 8pt monospace.
  // Fixes wrapping: Out-Printer used proportional font → 42 cols collapsed to ~24.
  // This uses fixed-pitch so columns line up on TM-T82X 80mm.
  const tmpPs1 = path.join(os.tmpdir(), `qv-${Date.now()}.ps1`);
  const printerB64 = Buffer.from(String(printerName), "utf16le").toString("base64");
  const textB64 = Buffer.from(String(text || ""), "utf8").toString("base64");
  const script = `
$ErrorActionPreference = 'Stop'
$printer = [System.Text.Encoding]::Unicode.GetString([System.Convert]::FromBase64String('${printerB64}'))
$text = [System.Text.Encoding]::UTF8.GetString([System.Convert]::FromBase64String('${textB64}'))
Add-Type -AssemblyName System.Drawing
$font = New-Object System.Drawing.Font('Courier New', 8.0, [System.Drawing.FontStyle]::Regular, [System.Drawing.GraphicsUnit]::Point)
$brush = [System.Drawing.Brushes]::Black
$lines = $text -split "\\r?\\n"
$doc = New-Object System.Drawing.Printing.PrintDocument
$doc.PrinterSettings.PrinterName = $printer
if (-not $doc.PrinterSettings.IsValid) { throw "Printer not found: $printer" }
$doc.DocumentName = 'QuickVerse Bill'
$doc.DefaultPageSettings.PaperSize = New-Object System.Drawing.Printing.PaperSize('80mm', 315, 2000)
$doc.DefaultPageSettings.Margins = New-Object System.Drawing.Printing.Margins(5,5,5,5)
$doc.add_PrintPage({
  param($sender, $e)
  $y = 0
  $lh = $font.GetHeight($e.Graphics)
  foreach($ln in $lines) {
    $e.Graphics.DrawString($ln, $font, $brush, 0, $y)
    $y += $lh
  }
  $e.HasMorePages = $false
})
$doc.Print()
`;
  fs.writeFileSync(tmpPs1, script, "utf8");
  const cmd = `powershell -NoProfile -ExecutionPolicy Bypass -File "${tmpPs1}"`;
  exec(cmd, { timeout: 20000 }, (err, stdout, stderr) => {
    try { fs.unlinkSync(tmpPs1); } catch {}
    if (err) return cb(new Error((stderr || stdout || err.message || "").trim().slice(0, 800)));
    cb(null);
  });
}

function sendToWindowsPrinter(printerName, text, cb) {
  // Thermal receipt printers (EPSON TM-*, TVSE RP) → GDI monospace so 42 cols
  // line up. Out-Printer used proportional font → collapsed to ~24 cols (photo).
  const thermal = /epson|tm-|tvse|rp3200|receipt|thermal|pos/i.test(String(printerName || ""));
  if (!thermal) {
    const tmp = path.join(os.tmpdir(), `qv-${Date.now()}.txt`);
    fs.writeFileSync(tmp, text, "utf8");
    const safePrinter = String(printerName).replace(/'/g, "''");
    const safeTmp = String(tmp).replace(/'/g, "''");
    const cmd = `powershell -NoProfile -Command "Get-Content -LiteralPath '${safeTmp}' -Raw | Out-Printer -Name '${safePrinter}'"`;
    exec(cmd, { timeout: 15000 }, (err) => {
      try { fs.unlinkSync(tmp); } catch {}
      cb(err);
    });
    return;
  }
  sendGdiToWindowsPrinter(printerName, text, (err) => {
    if (!err) return cb(null);
    // Fallback to legacy Out-Printer if GDI fails for any reason
    console.error("GDI failed, falling back:", err.message);
    const tmp = path.join(os.tmpdir(), `qv-${Date.now()}.txt`);
    fs.writeFileSync(tmp, text, "utf8");
    const safePrinter = String(printerName).replace(/'/g, "''");
    const safeTmp = String(tmp).replace(/'/g, "''");
    const cmd = `powershell -NoProfile -Command "Get-Content -LiteralPath '${safeTmp}' -Raw | Out-Printer -Name '${safePrinter}'"`;
    exec(cmd, { timeout: 15000 }, (ferr) => {
      try { fs.unlinkSync(tmp); } catch {}
      cb(ferr || err);
    });
  });
}

function isVirtualPrinter(name, driver, port) {
  // exp1: keep in sync with agent.ps1 Test-IsVirtualPrinter + frontend isVirtualPrinter().
  const n = String(name || "");
  const d = String(driver || "");
  const p = String(port || "");
  if (/Microsoft Print to PDF|Microsoft XPS|OneNote|Fax|Adobe PDF|CutePDF|PDFCreator|Bullzip|PrimoPDF|Print to File|Snagit|Snip & Sketch|XPS Document Writer/i.test(n)) return true;
  if (/Microsoft Print To PDF|Microsoft XPS|OneNote|Fax|Adobe PDF|CutePDF|PDFCreator|Bullzip|PrimoPDF/i.test(d)) return true;
  if (/^(PORTPROMPT:|SHR:|FILE:|NUL:|XpsPort:|Ne0)/i.test(p)) return true;
  return false;
}

function listWindowsPrinters(cb) {
  const cmd = `powershell -NoProfile -Command "Get-Printer | Select-Object Name,DriverName,PortName | ConvertTo-Json -Compress"`;
  exec(cmd, { timeout: 10000 }, (err, stdout) => {
    if (err) return cb(err);
    try {
      let arr = JSON.parse(String(stdout || "[]"));
      if (!Array.isArray(arr)) arr = arr ? [arr] : [];
      const detail = arr.map((r) => ({
        name: String(r.Name || ""),
        driver: String(r.DriverName || ""),
        port: String(r.PortName || ""),
        isVirtual: isVirtualPrinter(r.Name, r.DriverName, r.PortName),
      })).filter((x) => x.name);
      const names = detail.map((x) => x.name);
      const real = detail.filter((x) => !x.isVirtual).map((x) => x.name);
      cb(null, { names, real, detail });
    } catch (e) {
      // Fallback: old plain-name list if JSON parse fails
      const names = String(stdout || "").split(/\r?\n/).map((s) => s.trim()).filter(Boolean);
      const detail = names.map((name) => ({ name, driver: "", port: "", isVirtual: isVirtualPrinter(name, "", "") }));
      cb(null, { names, real: detail.filter((x) => !x.isVirtual).map((x) => x.name), detail });
    }
  });
}

const AGENT_VERSION = "1.3.0-exp1";

const server = http.createServer((req, res) => {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  // PNA (Private Network Access): lets a future HTTPS dashboard
  // (https://vendor.*) talk to this HTTP loopback agent. No-op on HTTP.
  // Chrome sends `Access-Control-Request-Private-Network: true` preflight;
  // we answer `Allow-Private-Network: true` so print keeps working post-HTTPS.
  res.setHeader("Access-Control-Allow-Private-Network", "true");
  if (req.method === "OPTIONS") { res.writeHead(204); return res.end(); }

  if (req.method === "GET" && req.url === "/status") {
    res.writeHead(200, { "Content-Type": "application/json" });
    return res.end(JSON.stringify({ online: true, version: AGENT_VERSION }));
  }

  if (req.method === "GET" && req.url === "/version") {
    res.writeHead(200, { "Content-Type": "application/json" });
    return res.end(JSON.stringify({ version: AGENT_VERSION }));
  }

  if (req.method === "GET" && req.url === "/printers") {
    listWindowsPrinters((err, result) => {
      if (err) {
        res.writeHead(500); return res.end("list failed: " + err.message);
      }
      res.writeHead(200, { "Content-Type": "application/json" });
      return res.end(JSON.stringify({ printers: result.names, real: result.real, detail: result.detail }));
    });
    return;
  }

  if (req.method === "POST" && req.url === "/print") {
    let body = "";
    req.on("data", (c) => (body += c));
    req.on("end", () => {
      try {
        const { printer, text } = JSON.parse(body);
        if (!printer || !text) {
          res.writeHead(400); return res.end("missing printer/text");
        }
        sendToWindowsPrinter(printer, text, (err) => {
          if (err) {
            console.error("Print failed:", err.message);
            res.writeHead(500); return res.end("print failed: " + err.message);
          }
          res.writeHead(200); return res.end("ok");
        });
      } catch (e) {
        res.writeHead(400); return res.end("bad json");
      }
    });
    return;
  }

  res.writeHead(404); res.end("not found");
});

server.listen(PORT, "127.0.0.1", () => {
  console.log(`QuickVerse print agent on http://127.0.0.1:${PORT} — printers share queue with PetPooja.`);
});
