# QuickVerse Print Agent v1.3.0-exp2 - pure PowerShell, ZERO installs.
# Runs on any Windows 10/11 out of the box. No Node, no npm, no exe.
# Listens only on http://127.0.0.1:1818 - unreachable from network.
# Dashboard calls: POST http://127.0.0.1:1818/print  { printer, text }
# Jobs go through the same Windows spooler queue PetPooja uses (FIFO, never half-mixed).
param(
    [int] $Port = 1818
)

$ErrorActionPreference = 'Stop'
$AGENT_VERSION = "1.3.0-exp2"

Add-Type -AssemblyName System.Drawing

function Send-Cors($res) {
    $res.Headers.Add("Access-Control-Allow-Origin", "*")
    $res.Headers.Add("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
    $res.Headers.Add("Access-Control-Allow-Headers", "Content-Type")
    # PNA: lets a future HTTPS dashboard talk to this HTTP loopback agent.
    $res.Headers.Add("Access-Control-Allow-Private-Network", "true")
}

function Send-Json($res, $obj) {
    $bytes = [System.Text.Encoding]::UTF8.GetBytes(($obj | ConvertTo-Json -Compress -Depth 4))
    $res.ContentType = "application/json"
    $res.ContentLength64 = $bytes.Length
    $res.OutputStream.Write($bytes, 0, $bytes.Length)
}

function Test-IsVirtualPrinter($name, $driver, $port) {
    # exp1: hide virtual / file-based queues by default (PDF, XPS, OneNote, Fax).
    # Everything else (USB, WSD, TCP/IP, EPSON/TVSE/STAR, HP/Canon/Brother) = real.
    # Keep dashboard fallback in sync: src/utils/print/printAgent.ts isVirtualPrinter().
    $n = "$name"
    $d = "$driver"
    $p = "$port"
    if ($n -match 'Microsoft Print to PDF|Microsoft XPS|OneNote|Fax|Adobe PDF|CutePDF|PDFCreator|Bullzip|PrimoPDF|Print to File|Snagit|Snip & Sketch|XPS Document Writer') { return $true }
    if ($d -match 'Microsoft Print To PDF|Microsoft XPS|OneNote|Fax|Adobe PDF|CutePDF|PDFCreator|Bullzip|PrimoPDF') { return $true }
    if ($p -match '^(PORTPROMPT:|SHR:|FILE:|NUL:|XpsPort:|Ne0)') { return $true }
    return $false
}

function Get-PrinterDetail() {
    $rows = @()
    try { $rows = @(Get-Printer | Select-Object Name, DriverName, PortName) } catch { $rows = @() }
    $detail = @()
    foreach ($r in $rows) {
        $v = Test-IsVirtualPrinter $r.Name $r.DriverName $r.PortName
        $detail += @{ name = [string]$r.Name; driver = [string]$r.DriverName; port = [string]$r.PortName; isVirtual = [bool]$v }
    }
    return $detail
}

function Get-QueueDetail() {
    # exp2: spooler truth — PrinterStatus + stuck/error jobs per queue.
    # Dashboard polls this to turn the Printer dot red BEFORE staff hits Reprint.
    $rows = @()
    try { $rows = @(Get-Printer | Select-Object Name, PrinterStatus, JobCount) } catch { $rows = @() }
    $out = @()
    foreach ($r in $rows) {
        $jobs = @()
        try { $jobs = @(Get-PrintJob -PrinterName $r.Name -ErrorAction SilentlyContinue) } catch { $jobs = @() }
        $jobErr = ""
        foreach ($j in $jobs) {
            $js = [string]$j.JobStatus
            if ($js -match 'Error|Blocked|Offline|PaperOut|NoToner|NotAvailable|UserIntervention|Paused') { $jobErr = $js; break }
        }
        $st = [string]$r.PrinterStatus
        $hasErr = $false
        $errText = ""
        if ($st -and $st -ne 'Normal' -and $st -ne 'Idle') { $hasErr = $true; $errText = $st }
        if ($jobErr) {
            $hasErr = $true
            if ($errText) { $errText = "$errText; $jobErr" } else { $errText = $jobErr }
        }
        $out += @{ name = [string]$r.Name; status = $st; jobs = [int]$jobs.Count; hasError = [bool]$hasErr; errorText = [string]$errText }
    }
    return $out
}

function Send-Text($res, $code, $text) {
    $bytes = [System.Text.Encoding]::UTF8.GetBytes($text)
    $res.StatusCode = $code
    $res.ContentLength64 = $bytes.Length
    $res.OutputStream.Write($bytes, 0, $bytes.Length)
}

function Print-Gdi($printerName, $text) {
    # GDI monospace: Courier New 8pt so 42 cols = one line on 80mm TM-T82X.
    # (Out-Printer uses proportional font and collapses 42 cols into ~24.)
    $lines = $text -split "\r?\n"
    $font = New-Object System.Drawing.Font('Courier New', 8.0, [System.Drawing.FontStyle]::Regular, [System.Drawing.GraphicsUnit]::Point)
    try {
        $brush = [System.Drawing.Brushes]::Black
        $doc = New-Object System.Drawing.Printing.PrintDocument
        $doc.PrinterSettings.PrinterName = $printerName
        if (-not $doc.PrinterSettings.IsValid) { throw "Printer not found: $printerName" }
        $doc.DocumentName = 'QuickVerse Bill'
        $doc.DefaultPageSettings.PaperSize = New-Object System.Drawing.Printing.PaperSize('80mm', 315, 2000)
        $doc.DefaultPageSettings.Margins = New-Object System.Drawing.Printing.Margins(5, 5, 5, 5)
        $state = @{ lines = $lines; font = $font; brush = $brush }
        $doc.add_PrintPage({
            param($sender, $e)
            $y = 0
            $lh = $state.font.GetHeight($e.Graphics)
            foreach ($ln in $state.lines) {
                $e.Graphics.DrawString($ln, $state.font, $state.brush, 0, $y)
                $y += $lh
            }
            $e.HasMorePages = $false
        }.GetNewClosure())
        $doc.Print()
    } finally { $font.Dispose() }
}

function Print-Text($printerName, $text) {
    if ($printerName -match 'epson|tm-|tvse|rp3200|receipt|thermal|pos') {
        Print-Gdi $printerName $text
    } else {
        # Non-thermal (PDF/XPS test queues): legacy spooler path.
        $tmp = Join-Path $env:TEMP ("qv-" + [DateTime]::Now.Ticks + ".txt")
        Set-Content -LiteralPath $tmp -Value $text -Encoding UTF8
        try { Get-Content -LiteralPath $tmp -Raw | Out-Printer -Name $printerName }
        finally { Remove-Item -LiteralPath $tmp -ErrorAction SilentlyContinue }
    }
}

$listener = New-Object System.Net.HttpListener
$listener.Prefixes.Add("http://127.0.0.1:$Port/")
$listener.Start()
Write-Output "QuickVerse print agent v$AGENT_VERSION on http://127.0.0.1:$Port - printers share queue with PetPooja."

while ($listener.IsListening) {
    $ctx = $listener.GetContext()
    $req = $ctx.Request
    $res = $ctx.Response
    try {
        Send-Cors $res
        $path = $req.Url.AbsolutePath
        if ($req.HttpMethod -eq "OPTIONS") {
            $res.StatusCode = 204
        } elseif ($req.HttpMethod -eq "GET" -and ($path -eq "/status")) {
            Send-Json $res @{ online = $true; version = $AGENT_VERSION }
        } elseif ($req.HttpMethod -eq "GET" -and $path -eq "/version") {
            Send-Json $res @{ version = $AGENT_VERSION }
        } elseif ($req.HttpMethod -eq "GET" -and $path -eq "/printers") {
            # exp1: printers = ALL names (backward compat), real = filtered, detail = per-queue meta.
            # Dashboard hides virtual by default, shows all when "Show all printers" is ticked.
            $detail = @(Get-PrinterDetail)
            $names = @($detail | ForEach-Object { $_.name })
            $real = @($detail | Where-Object { -not $_.isVirtual } | ForEach-Object { $_.name })
            Send-Json $res @{ printers = $names; real = $real; detail = $detail }
        } elseif ($req.HttpMethod -eq "GET" -and $path -eq "/queue") {
            # exp2: spooler truth for the dashboard dot + modal warnings.
            $queues = @(Get-QueueDetail)
            Send-Json $res @{ queues = $queues }
        } elseif ($req.HttpMethod -eq "POST" -and $path -eq "/print") {
            $reader = New-Object System.IO.StreamReader($req.InputStream, [System.Text.Encoding]::UTF8)
            try { $body = $reader.ReadToEnd() } finally { $reader.Close() }
            try { $data = $body | ConvertFrom-Json } catch { Send-Text $res 400 "bad json"; continue }
            if (-not $data.printer -or -not $data.text) { Send-Text $res 400 "missing printer/text"; continue }
            try {
                Print-Text $data.printer $data.text
                Send-Text $res 200 "ok"
            } catch {
                Write-Output ("Print failed: " + $_.Exception.Message)
                Send-Text $res 500 ("print failed: " + $_.Exception.Message)
            }
        } else {
            Send-Text $res 404 "not found"
        }
    } catch {
        $msg = $_.Exception.Message
        try { Send-Text $res 500 ('agent error: ' + $msg) } catch {}
    } finally {
        $res.OutputStream.Close()
    }
}
