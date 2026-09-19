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

function listWindowsPrinters(cb) {
  const cmd = `powershell -NoProfile -Command "Get-Printer | Select-Object -ExpandProperty Name"`;
  exec(cmd, { timeout: 10000 }, (err, stdout) => {
    if (err) return cb(err);
    const names = String(stdout || "").split(/\r?\n/).map((s) => s.trim()).filter(Boolean);
    cb(null, names);
  });
}

const server = http.createServer((req, res) => {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  if (req.method === "OPTIONS") { res.writeHead(204); return res.end(); }

  if (req.method === "GET" && req.url === "/status") {
    res.writeHead(200, { "Content-Type": "application/json" });
    return res.end(JSON.stringify({ online: true, version: "1.0.0" }));
  }

  if (req.method === "GET" && req.url === "/printers") {
    listWindowsPrinters((err, names) => {
      if (err) {
        res.writeHead(500); return res.end("list failed: " + err.message);
      }
      res.writeHead(200, { "Content-Type": "application/json" });
      return res.end(JSON.stringify({ printers: names }));
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
