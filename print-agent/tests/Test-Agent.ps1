# QuickVerse Print Agent test harness - plain PowerShell 5.1, no Pester.
# Vendor PCs have no modules, and this machine only has Pester 3.4.
# Runs the agent on port 18181 so it never fights the production agent on 1818.
# Exit code = number of failed assertions (0 = all green).
param(
    [int] $Port = 18181
)

$ErrorActionPreference = 'Stop'

$script:Failures = 0
function Assert-That($name, $cond, $detail) {
    if ($cond) {
        Write-Output ("PASS  " + $name)
    } else {
        $script:Failures = $script:Failures + 1
        Write-Output ("FAIL  " + $name + " -- " + $detail)
    }
}

$agentPath = Join-Path (Split-Path -Parent $PSScriptRoot) "agent.ps1"

# --- TC1 - syntax. Must run before anything else: every other test would
# --- report a misleading failure if the script simply does not parse.
$tokens = $null
$errors = $null
$ast = [System.Management.Automation.Language.Parser]::ParseFile($agentPath, [ref]$tokens, [ref]$errors)
$errText = ""
if ($errors -and $errors.Count -gt 0) {
    $errText = ($errors | ForEach-Object { "line " + $_.Extent.StartLineNumber + ": " + $_.Message }) -join " | "
}
Assert-That "TC1 syntax: agent.ps1 parses with zero errors" (@($errors).Count -eq 0) $errText
if (@($errors).Count -ne 0) {
    Write-Output "ABORT: agent.ps1 does not parse; skipping remaining tests."
    exit 1
}

# Pull the pure functions out of the AST. Dot-sourcing agent.ps1 would start
# the listener and never return. Invoke-Expression has to run at script scope,
# or the imported function dies with the scope that defined it.
function Get-AgentFunctionSource($name) {
    $hits = $ast.FindAll({
        param($node)
        $node -is [System.Management.Automation.Language.FunctionDefinitionAst] -and $node.Name -eq $name
    }, $true)
    if (@($hits).Count -ne 1) { return $null }
    return $hits[0].Extent.Text
}

$srcBreaks = Get-AgentFunctionSource "Get-PageBreaks"
$srcVirtual = Get-AgentFunctionSource "Test-IsVirtualPrinter"
$haveBreaks = ($null -ne $srcBreaks)
$haveVirtual = ($null -ne $srcVirtual)
Assert-That "TC9a pagination: Get-PageBreaks is defined exactly once in agent.ps1" $haveBreaks "function not found in AST"
Assert-That "TC10a routing: Test-IsVirtualPrinter is defined exactly once in agent.ps1" $haveVirtual "function not found in AST"
if ($haveBreaks) { Invoke-Expression $srcBreaks }
if ($haveVirtual) { Invoke-Expression $srcVirtual }

# --- TC9 - pagination arithmetic (pure, no printer needed).
# Courier New 8pt on the 80mm roll: ~12.8 units per line, 1995 usable units.
$lineHeight = 12.8
$pageHeight = 1995.0
$perPage = [int][Math]::Floor($pageHeight / $lineHeight)

if ($haveBreaks) {
    $short = @(1..10 | ForEach-Object { "line $_" })
    $b1 = @(Get-PageBreaks $short $lineHeight $pageHeight)
    Assert-That "TC9 pagination: 10 lines produce exactly one page starting at 0 (no regression)" (($b1.Count -eq 1) -and ($b1[0] -eq 0)) ("got [" + ($b1 -join ',') + "]")

    $n = 400
    $long = @(1..$n | ForEach-Object { "line $_" })
    $b2 = @(Get-PageBreaks $long $lineHeight $pageHeight)
    Assert-That "TC9 pagination: 400 lines produce more than one page" ($b2.Count -gt 1) ("got " + $b2.Count + " page(s)")

    # Walk the pages exactly as the PrintPage handler does and prove the slices
    # are contiguous, non-overlapping and cover every line exactly once.
    $covered = New-Object System.Collections.ArrayList
    $oversized = $false
    for ($p = 0; $p -lt $b2.Count; $p++) {
        $start = $b2[$p]
        if ($p + 1 -lt $b2.Count) { $end = $b2[$p + 1] - 1 } else { $end = $n - 1 }
        if (($end - $start + 1) -gt $perPage) { $oversized = $true }
        for ($i = $start; $i -le $end; $i++) { [void]$covered.Add($i) }
    }
    $exact = ($covered.Count -eq $n)
    if ($exact) {
        for ($i = 0; $i -lt $n; $i++) {
            if ($covered[$i] -ne $i) { $exact = $false; break }
        }
    }
    Assert-That "TC9 pagination: pages are contiguous, non-overlapping, cover all 400 lines once" $exact ("covered " + $covered.Count + " of " + $n)
    Assert-That "TC9 pagination: no page holds more lines than fit on it" (-not $oversized) ("a page exceeded " + $perPage + " lines")
}

# --- TC10 - routing decides on what the queue IS, not what it is called.
if ($haveVirtual) {
    $isPdf = Test-IsVirtualPrinter "Microsoft Print to PDF" "Microsoft Print To PDF" "PORTPROMPT:"
    Assert-That "TC10 routing: 'Microsoft Print to PDF' is virtual" ($isPdf -eq $true) ("got " + $isPdf)

    $isRenamed = Test-IsVirtualPrinter "Counter 1" "EPSON TM-T82X Receipt" "USB001"
    Assert-That "TC10 routing: renamed real queue 'Counter 1' is NOT virtual" ($isRenamed -eq $false) ("got " + $isRenamed)
}

# --- TC-C4 - POST /print must not be able to wedge the agent. T09 bounded the
# --- same cmdlet for /printers and /queue but left the print path raw, and the
# --- request loop is single-threaded: one hung Get-Printer there means no
# --- /status, no /printers, no /queue and no prints until a reboot.
$srcPrintText = Get-AgentFunctionSource "Print-Text"
$havePrintText = ($null -ne $srcPrintText)
Assert-That "TC-C4a hang: Print-Text is defined exactly once in agent.ps1" $havePrintText "function not found in AST"

# N5: TC-C4c used to scan only Print-Text's OWN body, so moving the raw lookup
# into a helper Print-Text calls kept it green while the wedge came back. This
# walks the transitive "this function's body mentions that other function's
# name" closure from a start point, so every function actually reachable from
# it gets scanned, however many helpers deep. Name-mention (not a full call
# graph) can only OVER-count, never miss a real call - a call always spells
# the callee's name in the caller's source - so it cannot under-detect.
function Get-ReachableAgentFunctionSources($ast, [string] $startName) {
    $allDefs = @($ast.FindAll({
        param($node)
        $node -is [System.Management.Automation.Language.FunctionDefinitionAst]
    }, $true))
    $byName = @{}
    foreach ($d in $allDefs) { $byName[$d.Name] = $d.Extent.Text }

    $visited = @{}
    $visited[$startName] = $true
    $queue = New-Object System.Collections.ArrayList
    [void]$queue.Add($startName)
    while ($queue.Count -gt 0) {
        $name = $queue[0]
        $queue.RemoveAt(0)
        $src = $byName[$name]
        if (-not $src) { continue }
        foreach ($otherName in $byName.Keys) {
            if ($visited.ContainsKey($otherName)) { continue }
            if ($src -match ("\b" + [regex]::Escape($otherName) + "\b")) {
                $visited[$otherName] = $true
                [void]$queue.Add($otherName)
            }
        }
    }
    $result = @{}
    foreach ($n in $visited.Keys) { $result[$n] = $byName[$n] }
    return $result
}

if ($havePrintText) {
    Assert-That "TC-C4b hang: Print-Text routes its printer lookup through Invoke-BoundedSpooler" ($srcPrintText -match 'Invoke-BoundedSpooler') "no bounded call in Print-Text"

    # Any Get-Printer that is not inside a bounded call, anywhere reachable
    # from /print (Print-Text itself or a helper it calls), runs on the
    # request thread. \b after Get-Printer excludes Get-PrinterDetail /
    # Get-PrinterRunspace, whose own declaration lines would otherwise match.
    $reachableFromPrint = Get-ReachableAgentFunctionSources $ast "Print-Text"
    $unboundedLine = ""
    $unboundedFn = ""
    foreach ($fnName in $reachableFromPrint.Keys) {
        foreach ($ln in ($reachableFromPrint[$fnName] -split "\r?\n")) {
            $trimmed = $ln.Trim()
            if (($trimmed -notmatch '^#') -and ($trimmed -match 'Get-Printer\b') -and ($trimmed -notmatch 'Invoke-BoundedSpooler')) {
                $unboundedLine = $trimmed
                $unboundedFn = $fnName
            }
        }
    }
    Assert-That "TC-C4c hang: no raw Get-Printer anywhere reachable from /print, even via a helper" ($unboundedLine -eq "") ("in " + $unboundedFn + ": " + $unboundedLine)

    Assert-That "TC-C4d hang: a timed-out lookup fails the request distinctly, not as 'Printer not found'" ($srcPrintText -match 'printer lookup timed out') "no distinct timeout failure in Print-Text"

    # TC-N5 self-check: prove the widened scan actually defeats the refactor
    # it is named for, on a synthetic AST it never executes. The helper name
    # deliberately does NOT contain "Get-Printer" - it must be caught by
    # reachability, not by coincidentally matching the scan regex on its name.
    $wedgeViaHelperSource = @'
function Resolve-PrinterRows() {
    return @(Get-Printer | Select-Object Name, DriverName, PortName)
}
function Print-Text($printerName, $text) {
    $rows = @(Resolve-PrinterRows)
    if (-not $rows) { throw "Printer not found: $printerName" }
}
'@
    $wedgeTokens = $null
    $wedgeErrors = $null
    $wedgeAst = [System.Management.Automation.Language.Parser]::ParseInput($wedgeViaHelperSource, [ref]$wedgeTokens, [ref]$wedgeErrors)
    $wedgeReachable = Get-ReachableAgentFunctionSources $wedgeAst "Print-Text"
    $wedgeUnboundedLine = ""
    foreach ($fnName in $wedgeReachable.Keys) {
        foreach ($ln in ($wedgeReachable[$fnName] -split "\r?\n")) {
            $trimmed = $ln.Trim()
            if (($trimmed -notmatch '^#') -and ($trimmed -match 'Get-Printer\b') -and ($trimmed -notmatch 'Invoke-BoundedSpooler')) { $wedgeUnboundedLine = $trimmed }
        }
    }
    Assert-That "TC-N5 self-check: the reachability scan catches the wedge even moved into a helper function" ($wedgeUnboundedLine -ne "") "widened check failed to detect the reintroduced wedge"
}

# --- TC-C4e/f - and the helper it now uses really is bounded: a spooler call
# --- that never returns must hand the request thread back, and must be
# --- reported as a timeout rather than as an empty printer list (which would
# --- come back to the vendor as a misleading "Printer not found").
$srcBounded = Get-AgentFunctionSource "Invoke-BoundedSpooler"
$srcRunspace = Get-AgentFunctionSource "Get-PrinterRunspace"
if (($null -ne $srcBounded) -and ($null -ne $srcRunspace)) {
    # Invoke-BoundedSpooler logs its timeout; the harness only needs the call to work.
    function Write-AgentLog($msg) { }
    Invoke-Expression $srcRunspace
    Invoke-Expression $srcBounded

    $script:PrinterCallTimeoutMs = 2000
    $script:PrinterRunspace = $null
    $script:LastSpoolerTimedOut = $false

    $swHang = [System.Diagnostics.Stopwatch]::StartNew()
    $hangRows = @(Invoke-BoundedSpooler { Start-Sleep -Seconds 30 } "HangProbe")
    $swHang.Stop()

    Assert-That ("TC-C4e hang: a printer lookup that never returns gives the thread back in " + [int]$swHang.Elapsed.TotalSeconds + "s") ($swHang.Elapsed.TotalSeconds -lt 15) ("took " + $swHang.Elapsed.TotalSeconds + "s")
    Assert-That "TC-C4f hang: the hang is reported as a timeout, not as an empty printer list" ($script:LastSpoolerTimedOut -eq $true) "LastSpoolerTimedOut was not set"
    Assert-That "TC-C4g hang: a bounded call that times out yields no rows" ($hangRows.Count -eq 0) ("got " + $hangRows.Count + " rows")
}


# --- HTTP helpers -----------------------------------------------------------
function Invoke-Agent($method, $path, $body, $timeoutSec, $targetPort, $extraHeaders) {
    # NOTE: PowerShell variable names are case-insensitive, so a parameter
    # literally named $port would shadow the script-scope $Port on every call
    # site below - hence $targetPort here instead.
    if (-not $targetPort) { $targetPort = $Port }
    $url = "http://127.0.0.1:$targetPort$path"
    try {
        $params = @{ Uri = $url; Method = $method; UseBasicParsing = $true; TimeoutSec = $timeoutSec }
        if ($null -ne $body) { $params.Body = $body; $params.ContentType = "application/json" }
        if ($extraHeaders) { $params.Headers = $extraHeaders }
        $r = Invoke-WebRequest @params
        return @{ code = [int]$r.StatusCode; text = [string]$r.Content; headers = $r.Headers }
    } catch [System.Net.WebException] {
        # Windows PowerShell 5.1 hands the error-response body to
        # ErrorDetails.Message and leaves the response stream already consumed,
        # so reading the stream first yields "". Take ErrorDetails, then fall
        # back to the stream for any case that does not populate it.
        $txt = ""
        if ($_.ErrorDetails -and $_.ErrorDetails.Message) { $txt = [string]$_.ErrorDetails.Message }
        $resp = $_.Exception.Response
        if ($resp) {
            $code = [int]$resp.StatusCode
            if (-not $txt) {
                try {
                    $sr = New-Object System.IO.StreamReader($resp.GetResponseStream())
                    $txt = $sr.ReadToEnd()
                    $sr.Close()
                } catch { }
            }
            return @{ code = $code; text = $txt; headers = $resp.Headers }
        }
        return @{ code = 0; text = $_.Exception.Message; headers = $null }
    } catch {
        return @{ code = 0; text = $_.Exception.Message; headers = $null }
    }
}

function Test-PortFree($p) {
    $c = New-Object System.Net.Sockets.TcpClient
    try { $c.Connect("127.0.0.1", $p); return $false }
    catch { return $true }
    finally { $c.Dispose() }
}

function Get-StatusCode($responseText) {
    if (-not $responseText) { return 0 }
    $first = ($responseText -split "`r`n")[0]
    $parts = $first -split ' '
    if ($parts.Count -lt 2) { return 0 }
    $code = 0
    if ([int]::TryParse($parts[1], [ref]$code)) { return $code }
    return 0
}

if (-not (Test-PortFree $Port)) {
    Write-Output ("ABORT: port " + $Port + " is already in use; cannot run agent tests.")
    exit 1
}

# --- start the agent --------------------------------------------------------
$outLog = Join-Path $env:TEMP "qv-test-agent-out.log"
$errLog = Join-Path $env:TEMP "qv-test-agent-err.log"
$proc = Start-Process -FilePath "powershell.exe" `
    -ArgumentList @("-NoProfile", "-ExecutionPolicy", "Bypass", "-File", $agentPath, "-Port", "$Port") `
    -PassThru -WindowStyle Hidden -RedirectStandardOutput $outLog -RedirectStandardError $errLog

try {
    $up = $false
    $deadline = (Get-Date).AddSeconds(30)
    while ((Get-Date) -lt $deadline) {
        $r = Invoke-Agent "GET" "/status" $null 3
        if ($r.code -eq 200) { $up = $true; break }
        Start-Sleep -Milliseconds 300
    }
    Assert-That "TC2 happy: agent starts and answers GET /status on $Port" $up "agent never came up; see $errLog"

    if ($up) {
        # --- TC2 - /status shape.
        $st = (Invoke-Agent "GET" "/status" $null 5)
        $stObj = $st.text | ConvertFrom-Json
        Assert-That "TC2 happy: /status returns online=true and a version string" (($stObj.online -eq $true) -and ($stObj.version -is [string]) -and ($stObj.version.Length -gt 0)) ("got " + $st.text)

        # --- TC3 - /printers shape.
        $pr = (Invoke-Agent "GET" "/printers" $null 20)
        $prObj = $pr.text | ConvertFrom-Json
        $names = $prObj.PSObject.Properties.Name
        $hasKeys = ($names -contains "printers") -and ($names -contains "real") -and ($names -contains "detail")
        Assert-That "TC3 happy: /printers has printers, real and detail keys" $hasKeys ("got keys: " + ($names -join ','))
        # An empty detail array must FAIL, not pass by checking nothing: a
        # stopped spooler makes Get-PrinterDetail swallow the error and answer
        # {"detail":[]}, which would otherwise report green having verified
        # nothing. Windows 10/11 always ships at least "Microsoft Print to PDF".
        $detailEntries = @($prObj.detail)
        Assert-That "TC3 happy: /printers detail is non-empty (else the shape check proves nothing)" ($detailEntries.Count -gt 0) "detail was empty - spooler stopped or no queues installed"
        $detailOk = ($detailEntries.Count -gt 0)
        $bad = ""
        foreach ($d in $detailEntries) {
            $dn = $d.PSObject.Properties.Name
            if (-not (($dn -contains "name") -and ($dn -contains "driver") -and ($dn -contains "port") -and ($dn -contains "isVirtual"))) {
                $detailOk = $false
                $bad = ($dn -join ',')
                break
            }
        }
        Assert-That "TC3 happy: every /printers detail entry has name/driver/port/isVirtual" $detailOk ("offending entry keys: " + $bad)

        # --- TC4 - /queue shape.
        $q = (Invoke-Agent "GET" "/queue" $null 30)
        $qObj = $q.text | ConvertFrom-Json
        $qNames = $qObj.PSObject.Properties.Name
        Assert-That "TC4 contract: /queue returns a queues array" (($qNames -contains "queues") -and ($null -ne $qObj.queues)) ("got " + $q.text)

        # --- TC5 / TC6 - POST /print input validation.
        $bad1 = Invoke-Agent "POST" "/print" "not-json" 10
        Assert-That "TC5 error: POST /print with 'not-json' returns 400" ($bad1.code -eq 400) ("got " + $bad1.code + " " + $bad1.text)

        $bad2 = Invoke-Agent "POST" "/print" '{"printer":"x"}' 10
        Assert-That "TC6 error: POST /print without text returns 400" ($bad2.code -eq 400) ("got " + $bad2.code + " " + $bad2.text)

        # --- TC12 - a nonexistent queue must travel end-to-end through
        # --- Print-Text and come back as 500 naming that queue verbatim,
        # --- brackets and all. Step 4 requires that not-found path preserved.
        $missing = "QuickVerse [Missing] Queue"
        $missBody = ConvertTo-Json @{ printer = $missing; text = "probe" } -Compress
        $miss = Invoke-Agent "POST" "/print" $missBody 20
        Assert-That "TC12 routing: POST /print to a bracket-named nonexistent queue returns 500" ($miss.code -eq 500) ("got " + $miss.code + " " + $miss.text)
        Assert-That "TC12 routing: the 500 body names that queue verbatim" (([string]$miss.text).Contains("Printer not found: " + $missing)) ("got body: " + $miss.text)

        # --- TC13 - regression guard for the wildcard-lookup bug. Build a name
        # --- that is NO queue's literal name but WOULD match a real one if the
        # --- lookup treated it as a pattern (Get-Printer -Name, or -eq typo'd
        # --- to -like). Correct code compares literally, so it must report the
        # --- probe as not found and must never reach a real printer.
        $allNames = @($prObj.printers)
        $realName = $null
        foreach ($nm in $allNames) {
            $s = [string]$nm
            if ($s.Length -ge 2 -and $s.Substring($s.Length - 1, 1) -match '^[A-Za-z0-9]$') { $realName = $s; break }
        }
        if (-not $realName) {
            Assert-That "TC13 routing: an installed queue was available to build the wildcard probe from" $false "no installed queue ends in an alphanumeric character"
        } else {
            $tail = $realName.Substring($realName.Length - 1, 1)
            $probe = $realName.Substring(0, $realName.Length - 1) + "[" + $tail + "]"
            $literalHits = @($allNames | Where-Object { [string]$_ -eq $probe }).Count
            $wildHits = @($allNames | Where-Object { [string]$_ -like $probe }).Count
            # If the probe did not discriminate, this test would be worthless.
            Assert-That ("TC13 routing: probe '" + $probe + "' discriminates (0 literal, " + $wildHits + " wildcard match)") (($literalHits -eq 0) -and ($wildHits -ge 1)) ("literal=" + $literalHits + " wildcard=" + $wildHits)
            $wildBody = ConvertTo-Json @{ printer = $probe; text = "probe" } -Compress
            $wild = Invoke-Agent "POST" "/print" $wildBody 20
            $namedExactly = ([string]$wild.text).Contains("Printer not found: " + $probe)
            Assert-That "TC13 routing: a wildcard-shaped queue name is matched literally, never as a pattern" (($wild.code -eq 500) -and $namedExactly) ("got " + $wild.code + " " + $wild.text)
        }

        # --- TC7 - THE CRITICAL ONE. A client that announces a body and then
        # --- sends nothing must not wedge the single-threaded loop.
        $hang = New-Object System.Net.Sockets.TcpClient
        $elapsed = 0.0
        $statusCode = 0
        try {
            $hang.Connect("127.0.0.1", $Port)
            $hs = $hang.GetStream()
            $reqText = "POST /print HTTP/1.1`r`nHost: 127.0.0.1:$Port`r`nContent-Type: application/json`r`nContent-Length: 500000`r`n`r`n"
            $reqBytes = [System.Text.Encoding]::ASCII.GetBytes($reqText)
            $hs.Write($reqBytes, 0, $reqBytes.Length)
            $hs.Flush()
            # Deliberately send no body at all and hold the socket open.
            $sw = [System.Diagnostics.Stopwatch]::StartNew()
            $live = Invoke-Agent "GET" "/status" $null 44
            $sw.Stop()
            $elapsed = $sw.Elapsed.TotalSeconds
            $statusCode = $live.code
        } finally {
            try { $hang.Close() } catch { }
        }
        Assert-That ("TC7 hang: /status still answered within 45s while a stalled POST held the socket (" + [int]$elapsed + "s)") (($statusCode -eq 200) -and ($elapsed -lt 45)) ("status=" + $statusCode + " after " + $elapsed + "s")

        # --- TC8 - oversized body is refused with 413, agent survives.
        $big = New-Object System.Net.Sockets.TcpClient
        $bigCode = 0
        try {
            $big.Connect("127.0.0.1", $Port)
            $bs = $big.GetStream()
            $bs.ReadTimeout = 40000
            $payload = [System.Text.Encoding]::ASCII.GetBytes(('{"printer":"x","text":"' + ('A' * 1100000) + '"}'))
            $hdrText = "POST /print HTTP/1.1`r`nHost: 127.0.0.1:$Port`r`nContent-Type: application/json`r`nContent-Length: $($payload.Length)`r`n`r`n"
            $hdrBytes = [System.Text.Encoding]::ASCII.GetBytes($hdrText)
            $bs.Write($hdrBytes, 0, $hdrBytes.Length)
            $bs.Flush()
            # The agent answers on Content-Length alone, so the write may be cut
            # short by its reply. That is the point of the test, not a failure.
            try { $bs.Write($payload, 0, $payload.Length); $bs.Flush() } catch { }
            $buf = New-Object byte[] 1024
            $read = 0
            try { $read = $bs.Read($buf, 0, $buf.Length) } catch { $read = 0 }
            if ($read -gt 0) {
                $bigCode = Get-StatusCode ([System.Text.Encoding]::ASCII.GetString($buf, 0, $read))
            }
        } finally {
            try { $big.Close() } catch { }
        }
        Assert-That "TC8 limit: POST /print with a body over 1MB returns 413" ($bigCode -eq 413) ("got status " + $bigCode)

        $after = Invoke-Agent "GET" "/status" $null 20
        Assert-That "TC8 limit: agent still answers /status after the oversized body" ($after.code -eq 200) ("got " + $after.code + " " + $after.text)

        # --- T09 CORS allowlist. Origin locking must never affect a
        # --- non-browser caller (no Origin header at all), must never emit a
        # --- wildcard, and must match the allowlist literally - never by
        # --- substring or pattern.
        $allowedOrigin = "https://vendor-dashboard-quickverse.vercel.app"
        $deniedOrigin = "https://evil.example.com"
        $lookalikeOrigin = "https://evil-vendor-dashboard-quickverse.vercel.app.attacker.com"
        $localhostOrigin = "http://localhost:5173"

        $corsNoOrigin = Invoke-Agent "GET" "/status" $null 10
        Assert-That "CORS-TC1 installer: GET /status with no Origin header returns 200 (served normally)" ($corsNoOrigin.code -eq 200) ("got " + $corsNoOrigin.code)

        $corsAllowed = Invoke-Agent "GET" "/status" $null 10 $null @{ Origin = $allowedOrigin }
        Assert-That "CORS-TC2 allowed: GET /status with an allowed Origin returns 200" ($corsAllowed.code -eq 200) ("got " + $corsAllowed.code)
        Assert-That "CORS-TC2 allowed: Access-Control-Allow-Origin exactly echoes the allowed origin" ([string]$corsAllowed.headers["Access-Control-Allow-Origin"] -eq $allowedOrigin) ("got [" + $corsAllowed.headers["Access-Control-Allow-Origin"] + "]")
        Assert-That "CORS-TC3 PNA: the allowed response also carries Access-Control-Allow-Private-Network: true" ([string]$corsAllowed.headers["Access-Control-Allow-Private-Network"] -eq "true") ("got [" + $corsAllowed.headers["Access-Control-Allow-Private-Network"] + "]")

        $corsDenied = Invoke-Agent "GET" "/status" $null 10 $null @{ Origin = $deniedOrigin }
        Assert-That "CORS-TC4 denied: GET /status with a disallowed Origin returns no Access-Control-Allow-Origin header" ($null -eq $corsDenied.headers["Access-Control-Allow-Origin"]) ("got [" + $corsDenied.headers["Access-Control-Allow-Origin"] + "]")

        $corsLookalike = Invoke-Agent "GET" "/status" $null 10 $null @{ Origin = $lookalikeOrigin }
        Assert-That "CORS-TC6 no-substring: an origin containing an allowed origin as a substring is denied" ($null -eq $corsLookalike.headers["Access-Control-Allow-Origin"]) ("got [" + $corsLookalike.headers["Access-Control-Allow-Origin"] + "]")

        $corsLocalhost = Invoke-Agent "GET" "/status" $null 10 $null @{ Origin = $localhostOrigin }
        Assert-That "CORS-TC8 localhost: GET /status with Origin http://localhost:5173 is allowed" ([string]$corsLocalhost.headers["Access-Control-Allow-Origin"] -eq $localhostOrigin) ("got [" + $corsLocalhost.headers["Access-Control-Allow-Origin"] + "]")

        $corsPreflight = Invoke-Agent "OPTIONS" "/print" $null 10 $null @{ Origin = $allowedOrigin }
        Assert-That "CORS-TC7 preflight: OPTIONS /print with an allowed Origin returns 204" ($corsPreflight.code -eq 204) ("got " + $corsPreflight.code)
        Assert-That "CORS-TC7 preflight: OPTIONS /print echoes the allowed origin" ([string]$corsPreflight.headers["Access-Control-Allow-Origin"] -eq $allowedOrigin) ("got [" + $corsPreflight.headers["Access-Control-Allow-Origin"] + "]")

        $corsNoWildcard = $true
        $corsWildcardDetail = ""
        $corsChecked = @(
            @{ label = "no-origin"; resp = $corsNoOrigin },
            @{ label = "allowed"; resp = $corsAllowed },
            @{ label = "denied"; resp = $corsDenied },
            @{ label = "lookalike"; resp = $corsLookalike },
            @{ label = "localhost"; resp = $corsLocalhost },
            @{ label = "preflight"; resp = $corsPreflight }
        )
        foreach ($entry in $corsChecked) {
            if ($entry.resp.headers -and ([string]$entry.resp.headers["Access-Control-Allow-Origin"] -eq "*")) {
                $corsNoWildcard = $false
                $corsWildcardDetail = $entry.label
            }
        }
        Assert-That "CORS-TC5 no-wildcard: Access-Control-Allow-Origin is never '*' on any of the above responses" $corsNoWildcard ("wildcard found on: " + $corsWildcardDetail)
        # CORS-TC9 (regression) is every pre-existing assertion in this file still passing.

        # --- T09 step 7 - bounded spooler calls. Cannot fault-inject a wedged
        # --- spooler from here, but this proves the bounded call path answers
        # --- well within budget when the spooler is healthy.
        $boundMaxSeconds = 10
        $swPrinters = [System.Diagnostics.Stopwatch]::StartNew()
        $printersBounded = Invoke-Agent "GET" "/printers" $null 20
        $swPrinters.Stop()
        Assert-That ("TIMEOUT-TC1: GET /printers answers within " + $boundMaxSeconds + "s (" + [int]$swPrinters.Elapsed.TotalSeconds + "s)") (($printersBounded.code -eq 200) -and ($swPrinters.Elapsed.TotalSeconds -lt $boundMaxSeconds)) ("code=" + $printersBounded.code + " elapsed=" + $swPrinters.Elapsed.TotalSeconds)

        $swQueue = [System.Diagnostics.Stopwatch]::StartNew()
        $queueBounded = Invoke-Agent "GET" "/queue" $null 20
        $swQueue.Stop()
        Assert-That ("TIMEOUT-TC2: GET /queue answers within " + $boundMaxSeconds + "s (" + [int]$swQueue.Elapsed.TotalSeconds + "s)") (($queueBounded.code -eq 200) -and ($swQueue.Elapsed.TotalSeconds -lt $boundMaxSeconds)) ("code=" + $queueBounded.code + " elapsed=" + $swQueue.Elapsed.TotalSeconds)
    }
} finally {
    # --- TC11 - never leave the agent running.
    try { Stop-Process -Id $proc.Id -Force -ErrorAction SilentlyContinue } catch { }
}

$stopped = $false
$deadline = (Get-Date).AddSeconds(20)
while ((Get-Date) -lt $deadline) {
    if (Test-PortFree $Port) { $stopped = $true; break }
    Start-Sleep -Milliseconds 300
}
Assert-That "TC11 shutdown: agent stopped and port $Port is free" $stopped "port still bound after 20s"

# --- T09 step 6 handoff - the single-instance mutex must be keyed by port.
# --- Runs after the main agent above is fully stopped, on its own two fresh
# --- ports, so it never overlaps the $Port agent or the real 1818 agent.
$mtxPortA = 18182
$mtxPortB = 18183
if (-not (Test-PortFree $mtxPortA) -or -not (Test-PortFree $mtxPortB)) {
    Assert-That "TC-MUTEX setup: ports $mtxPortA and $mtxPortB are free for the mutex test" $false "one of the mutex-test ports is already in use"
} else {
    $mtxProcA = $null
    $mtxProcB = $null
    $mtxProcSame = $null
    try {
        $mtxProcA = Start-Process -FilePath "powershell.exe" `
            -ArgumentList @("-NoProfile", "-ExecutionPolicy", "Bypass", "-File", $agentPath, "-Port", "$mtxPortA") `
            -PassThru -WindowStyle Hidden `
            -RedirectStandardOutput (Join-Path $env:TEMP "qv-test-mutexA-out.log") `
            -RedirectStandardError (Join-Path $env:TEMP "qv-test-mutexA-err.log")

        $mtxUpA = $false
        $deadline = (Get-Date).AddSeconds(30)
        while ((Get-Date) -lt $deadline) {
            $r = @(Invoke-Agent "GET" "/status" $null 3 $mtxPortA)
            if ($r[0].code -eq 200) { $mtxUpA = $true; break }
            Start-Sleep -Milliseconds 300
        }
        Assert-That "TC-MUTEX: agent A on port $mtxPortA comes up" $mtxUpA "agent A never answered /status"

        $mtxProcB = Start-Process -FilePath "powershell.exe" `
            -ArgumentList @("-NoProfile", "-ExecutionPolicy", "Bypass", "-File", $agentPath, "-Port", "$mtxPortB") `
            -PassThru -WindowStyle Hidden `
            -RedirectStandardOutput (Join-Path $env:TEMP "qv-test-mutexB-out.log") `
            -RedirectStandardError (Join-Path $env:TEMP "qv-test-mutexB-err.log")

        $mtxUpB = $false
        $deadline = (Get-Date).AddSeconds(30)
        while ((Get-Date) -lt $deadline) {
            $r = @(Invoke-Agent "GET" "/status" $null 3 $mtxPortB)
            if ($r[0].code -eq 200) { $mtxUpB = $true; break }
            Start-Sleep -Milliseconds 300
        }
        Assert-That "TC-MUTEX: agent B on a DIFFERENT port ($mtxPortB) also comes up while A is running" $mtxUpB "agent B never answered /status while A held a different port"

        # A second agent on the SAME port as A must still be refused (exit 2) -
        # the per-port change must not weaken the existing single-instance guard.
        # No -RedirectStandardOutput/-RedirectStandardError here: on this host
        # combining redirection with -PassThru leaves the returned process's
        # ExitCode $null even after HasExited is true; plain -WindowStyle Hidden
        # (as used elsewhere in this file) reports ExitCode correctly.
        $mtxProcSame = Start-Process -FilePath "powershell.exe" `
            -ArgumentList @("-NoProfile", "-ExecutionPolicy", "Bypass", "-File", $agentPath, "-Port", "$mtxPortA") `
            -PassThru -WindowStyle Hidden
        $mtxExited = $mtxProcSame.WaitForExit(15000)
        $mtxSameCode = -1
        if ($mtxExited) { $mtxSameCode = $mtxProcSame.ExitCode }
        Assert-That "TC-MUTEX: a second agent on the SAME port ($mtxPortA) still exits 2" ($mtxExited -and ($mtxSameCode -eq 2)) ("exited=" + $mtxExited + " code=" + $mtxSameCode)
    } finally {
        foreach ($p in @($mtxProcA, $mtxProcB, $mtxProcSame)) {
            if ($p) { try { Stop-Process -Id $p.Id -Force -ErrorAction SilentlyContinue } catch { } }
        }
    }
}

Write-Output ""
if ($script:Failures -eq 0) {
    Write-Output "ALL TESTS PASSED"
} else {
    Write-Output ("FAILED ASSERTIONS: " + $script:Failures)
}
exit $script:Failures
