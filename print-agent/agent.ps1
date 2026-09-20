# QuickVerse Print Agent v1.3.2 - pure PowerShell, ZERO installs.
# Runs on any Windows 10/11 out of the box. No Node, no npm, no exe.
# Listens only on http://127.0.0.1:1818 - unreachable from network.
# Dashboard calls: POST http://127.0.0.1:1818/print  { printer, text }
# Jobs go through the same Windows spooler queue PetPooja uses (FIFO, never half-mixed).
param(
    [int] $Port = 1818
)

$ErrorActionPreference = 'Stop'
$AGENT_VERSION = "1.3.2"

# T09: dashboard-only CORS. If the dashboard is ever served from a new
# domain, this is the single place to update.
$ALLOWED_ORIGINS = @(
    "https://vendor-dashboard-quickverse.vercel.app",
    "http://prd.quickverse.in",
    "http://localhost:5173",
    "http://127.0.0.1:5173"
)

# exp3: single-instance guard — ONE holder of 127.0.0.1:1818 per PC.
# Double-clicks (visible .bat + hidden Startup .vbs + Scheduler) used to fight
# over the http.sys prefix and die with a scary HttpListenerException, then
# staff closed the GOOD window. Now the 2nd launch exits friendly (code 2).
# Pre-probe catches ANY holder (ps1, Node server.js, old version); the named
# Mutex covers the start-up race. Auto-start = Task Scheduler (primary);
# visible .bat is for testing only. server.js fallback is kept, untouched.
$script:AgentMutex = $null
try {
    $probe = Invoke-RestMethod -Uri "http://127.0.0.1:$Port/status" -TimeoutSec 2
    if ($probe.online) {
        $pv = if ($probe.version) { " (v$($probe.version))" } else { "" }
        Write-Output "QuickVerse print agent: Already running$pv on http://127.0.0.1:$Port - close this window, helper is up. Verify: http://127.0.0.1:$Port/status"
        exit 2
    }
} catch { <# nothing listening — safe to start #> }
try {
    $script:AgentMutex = New-Object System.Threading.Mutex($false, "Global\QuickVersePrintAgent$Port")
    if (-not $script:AgentMutex.WaitOne(0, $false)) {
        Write-Output "QuickVerse print agent: Already running on http://127.0.0.1:$Port - close this window, helper is up. Verify: http://127.0.0.1:$Port/status"
        exit 2
    }
} catch { <# mutex unavailable — pre-probe already passed, continue #> }

# Log dir captured at script scope ($MyInvocation inside a function points at
# the function, not the script).
$script:AgentDir = try { Split-Path -Parent $MyInvocation.MyCommand.Path } catch { "" }
if (-not $script:AgentDir) { $script:AgentDir = $env:TEMP }

function Write-AgentLog($msg) {
    # exp3: append-only log next to the script. Never throws — logging must
    # never break printing.
    try {
        $line = "[$(Get-Date -Format 'yyyy-MM-dd HH:mm:ss')] $msg"
        Add-Content -LiteralPath (Join-Path $script:AgentDir "agent.log") -Value $line -Encoding UTF8 -ErrorAction SilentlyContinue
    } catch { }
}

# exp3: warn (don't refuse — never break a working shop) when running from a
# fragile folder. Canonical home: C:\QuickVerse\print-agent.
try {
    if ($script:AgentDir -match 'Downloads|\\Temp\\?|Desktop') {
        Write-Output "WARNING: running from $script:AgentDir - move to C:\QuickVerse\print-agent for reboot-proof auto-start. Continuing..."
        Write-AgentLog "WARN running from fragile path: $script:AgentDir"
    }
} catch { }

Add-Type -AssemblyName System.Drawing

function Send-Cors($req, $res) {
    # T09: origin-locked CORS. No Origin header means a non-browser caller
    # (installer, curl, Invoke-RestMethod) - CORS is a browser-only
    # mechanism, so serve the request normally with no CORS headers at all.
    $origin = $req.Headers["Origin"]
    if (-not $origin) { return }
    if ($ALLOWED_ORIGINS -contains $origin) {
        $res.Headers.Add("Access-Control-Allow-Origin", $origin)
        $res.Headers.Add("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
        $res.Headers.Add("Access-Control-Allow-Headers", "Content-Type")
        # PNA: lets the HTTPS dashboard talk to this HTTP loopback agent.
        $res.Headers.Add("Access-Control-Allow-Private-Network", "true")
    } else {
        Write-AgentLog "CORS-DENY $origin"
    }
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

# T09 step 7: Get-Printer / Get-PrintJob talk to the Windows spooler, and a
# wedged spooler is a common real-world failure. /printers and /queue are the
# dashboard's most-polled routes (every 30s), so both cmdlets run through a
# dedicated runspace with a hard time limit instead of directly on the
# request thread. The runspace is reused across calls so the common case
# (spooler healthy) pays the PrintManagement module's import cost once, not
# on every poll. A timeout abandons that runspace - it may still be blocked
# inside the stuck native call, so closing it could itself block - and the
# next call opens a fresh one.
$script:PrinterCallTimeoutMs = 3000
$script:PrinterRunspace = $null

function Get-PrinterRunspace() {
    if (-not $script:PrinterRunspace -or $script:PrinterRunspace.RunspaceStateInfo.State -ne 'Opened') {
        $script:PrinterRunspace = [runspacefactory]::CreateRunspace()
        $script:PrinterRunspace.Open()
    }
    return $script:PrinterRunspace
}

function Invoke-BoundedSpooler([scriptblock] $Script, [string] $Label, [object[]] $ArgumentList) {
    $ps = [powershell]::Create()
    $ps.Runspace = Get-PrinterRunspace
    try {
        [void]$ps.AddScript($Script)
        if ($ArgumentList) { foreach ($a in $ArgumentList) { [void]$ps.AddArgument($a) } }
        $async = $ps.BeginInvoke()
        if ($async.AsyncWaitHandle.WaitOne($script:PrinterCallTimeoutMs)) {
            return $ps.EndInvoke($async)
        }
        Write-AgentLog "TIMEOUT: $Label exceeded $($script:PrinterCallTimeoutMs)ms"
        try { $ps.Stop() } catch { }
        $script:PrinterRunspace = $null
        return @()
    } finally {
        try { $ps.Dispose() } catch { }
    }
}

function Get-PrinterDetail() {
    $rows = @()
    try { $rows = @(Invoke-BoundedSpooler { Get-Printer | Select-Object Name, DriverName, PortName } "Get-Printer") } catch { $rows = @() }
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
    try { $rows = @(Invoke-BoundedSpooler { Get-Printer | Select-Object Name, PrinterStatus, JobCount } "Get-Printer") } catch { $rows = @() }
    $out = @()
    foreach ($r in $rows) {
        $jobs = @()
        try { $jobs = @(Invoke-BoundedSpooler { param($n) Get-PrintJob -PrinterName $n -ErrorAction SilentlyContinue } "Get-PrintJob" @($r.Name)) } catch { $jobs = @() }
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

function Get-PageBreaks([string[]] $lines, [double] $lineHeight, [double] $pageHeight) {
    # Start index of every page. While the bill fits there is exactly one page
    # starting at 0, so bills that printed fine before pagination existed are
    # rendered byte-for-byte as before. Callers must wrap the result in @():
    # a one-page result unrolls to a bare int otherwise.
    $perPage = [int][Math]::Floor($pageHeight / $lineHeight)
    if ($perPage -lt 1) { $perPage = 1 }
    $count = @($lines).Count
    if ($count -le $perPage) { return @(0) }
    $breaks = @()
    for ($i = 0; $i -lt $count; $i += $perPage) { $breaks += $i }
    return $breaks
}

function Print-Gdi($printerName, $text) {
    # GDI monospace: Courier New 8pt so 42 cols = one line on 80mm TM-T82X.
    # (Out-Printer uses proportional font and collapses 42 cols into ~24.)
    $lines = @($text -split "\r?\n")
    $font = New-Object System.Drawing.Font('Courier New', 8.0, [System.Drawing.FontStyle]::Regular, [System.Drawing.GraphicsUnit]::Point)
    $doc = $null
    try {
        $brush = [System.Drawing.Brushes]::Black
        $doc = New-Object System.Drawing.Printing.PrintDocument
        $doc.PrinterSettings.PrinterName = $printerName
        if (-not $doc.PrinterSettings.IsValid) { throw "Printer not found: $printerName" }
        $doc.DocumentName = 'QuickVerse Bill'
        $doc.DefaultPageSettings.PaperSize = New-Object System.Drawing.Printing.PaperSize('80mm', 315, 2000)
        $doc.DefaultPageSettings.Margins = New-Object System.Drawing.Printing.Margins(5, 5, 5, 5)
        $state = @{ lines = $lines; font = $font; brush = $brush; page = 0; breaks = $null }
        $doc.add_PrintPage({
            param($sender, $e)
            $lh = $state.font.GetHeight($e.Graphics)
            # Line height needs a real page Graphics, so the map is built on the
            # first page and reused: one job, one font, one paper size.
            if ($null -eq $state.breaks) {
                $state.breaks = @(Get-PageBreaks $state.lines $lh $e.MarginBounds.Bottom)
            }
            $start = $state.breaks[$state.page]
            if ($state.page + 1 -lt $state.breaks.Count) { $end = $state.breaks[$state.page + 1] - 1 }
            else { $end = $state.lines.Count - 1 }
            $y = 0
            for ($i = $start; $i -le $end; $i++) {
                $e.Graphics.DrawString($state.lines[$i], $state.font, $state.brush, 0, $y)
                $y += $lh
            }
            $state.page = $state.page + 1
            # Anything past the page bottom used to be clipped and lost.
            $e.HasMorePages = ($state.page -lt $state.breaks.Count)
        }.GetNewClosure())
        $doc.Print()
    } finally {
        if ($doc) { $doc.Dispose() }
        $font.Dispose()
    }
}

function Print-Text($printerName, $text) {
    # Route on what the queue IS, not what it is called. Matching the name meant
    # a vendor renaming the queue to "Counter 1" fell through to Out-Printer,
    # whose proportional font destroys the 42-column layout.
    # Exact name match, never Get-Printer -Name: that treats the name as a
    # wildcard pattern, so a queue called "Bar [Back]" would look missing.
    $row = @(Get-Printer | Select-Object Name, DriverName, PortName) |
        Where-Object { $_.Name -eq $printerName } | Select-Object -First 1
    if (-not $row) { throw "Printer not found: $printerName" }
    if (Test-IsVirtualPrinter $row.Name $row.DriverName $row.PortName) {
        # Virtual / file queue (PDF, XPS): legacy spooler path.
        $tmp = Join-Path $env:TEMP ("qv-" + [DateTime]::Now.Ticks + ".txt")
        Set-Content -LiteralPath $tmp -Value $text -Encoding UTF8
        try { Get-Content -LiteralPath $tmp -Raw | Out-Printer -Name $printerName }
        finally { Remove-Item -LiteralPath $tmp -ErrorAction SilentlyContinue }
    } else {
        Print-Gdi $printerName $text
    }
}

$listener = New-Object System.Net.HttpListener
$listener.Prefixes.Add("http://127.0.0.1:$Port/")
# Hang-proofing. The loop is single-threaded, so one client that opens a request
# and then stalls would block every other caller forever. These hand that job to
# http.sys, which kills the stalled client for us. RequestQueue stays well above
# EntityBody so a request queued behind a stalled one is never dropped before
# the loop reaches it. Unsupported on some Windows builds: degrade, never crash.
try {
    $listener.TimeoutManager.EntityBody      = [TimeSpan]::FromSeconds(15)
    $listener.TimeoutManager.HeaderWait      = [TimeSpan]::FromSeconds(15)
    $listener.TimeoutManager.IdleConnection  = [TimeSpan]::FromSeconds(15)
    $listener.TimeoutManager.DrainEntityBody = [TimeSpan]::FromSeconds(15)
    $listener.TimeoutManager.RequestQueue    = [TimeSpan]::FromSeconds(30)
} catch { Write-AgentLog ("TIMEOUTS unavailable on this Windows build: " + $_.Exception.Message) }
try {
    $listener.Start()
} catch {
    # Race lost after pre-probe (two launches same second): friendly, not red.
    Write-Output "QuickVerse print agent: Already running on http://127.0.0.1:$Port - close this window, helper is up. Verify: http://127.0.0.1:$Port/status"
    Write-AgentLog "START conflict: another holder owns 1818, exiting 2"
    exit 2
}
Write-Output "QuickVerse print agent v$AGENT_VERSION on http://127.0.0.1:$Port - printers share queue with PetPooja."
Write-AgentLog "START v$AGENT_VERSION on 127.0.0.1:$Port"

while ($listener.IsListening) {
    try {
        $ctx = $listener.GetContext()
    } catch {
        # Client reset, or http.sys killed a stalled request. One bad client
        # must never end the loop.
        if (-not $listener.IsListening) { break }
        Write-AgentLog ("ACCEPT-FAIL: " + $_.Exception.Message)
        continue
    }
    $req = $ctx.Request
    $res = $ctx.Response
    try {
        Send-Cors $req $res
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
            # Bounded read: 1MB is ~25x the largest realistic bill. An unbounded
            # ReadToEnd on an untrusted stream is how this loop gets wedged.
            $cap = 1048576
            if ($req.ContentLength64 -gt $cap) { Send-Text $res 413 "body too large"; continue }
            $want = $cap
            if ($req.ContentLength64 -ge 0 -and $req.ContentLength64 -lt $cap) { $want = [int]$req.ContentLength64 }
            $body = ""
            $ms = New-Object System.IO.MemoryStream
            try {
                $chunk = New-Object byte[] 8192
                $got = 0
                while ($got -lt $want) {
                    $n = $req.InputStream.Read($chunk, 0, [Math]::Min(8192, $want - $got))
                    if ($n -le 0) { break }
                    $ms.Write($chunk, 0, $n)
                    $got += $n
                }
                $body = [System.Text.Encoding]::UTF8.GetString($ms.ToArray())
            } finally { $ms.Dispose() }
            try { $data = $body | ConvertFrom-Json } catch { Send-Text $res 400 "bad json"; continue }
            if (-not $data.printer -or -not $data.text) { Send-Text $res 400 "missing printer/text"; continue }
            try {
                Print-Text $data.printer $data.text
                Send-Text $res 200 "ok"
            } catch {
                Write-Output ("Print failed: " + $_.Exception.Message)
                Write-AgentLog ("PRINT-FAIL [$($data.printer)]: " + $_.Exception.Message)
                Send-Text $res 500 ("print failed: " + $_.Exception.Message)
            }
        } else {
            Send-Text $res 404 "not found"
        }
    } catch {
        $msg = $_.Exception.Message
        Write-AgentLog ("REQUEST-FAIL: " + $msg)
        try { Send-Text $res 500 ('agent error: ' + $msg) } catch {}
    } finally {
        # Closing a stream whose client already vanished throws, and with
        # ErrorActionPreference=Stop that would end the agent for good.
        try { $res.OutputStream.Close() } catch { }
    }
}

# Only reachable if the listener stopped on its own. Never exit 0 here, so Task
# Scheduler treats it as a failure and its -RestartCount 3 applies.
Write-AgentLog "STOP listener stopped unexpectedly - exiting 3"
Write-Output "QuickVerse print agent: listener stopped unexpectedly - exiting."
exit 3
