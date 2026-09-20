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

# --- HTTP helpers -----------------------------------------------------------
function Invoke-Agent($method, $path, $body, $timeoutSec) {
    $url = "http://127.0.0.1:$Port$path"
    try {
        if ($null -ne $body) {
            $r = Invoke-WebRequest -Uri $url -Method $method -Body $body -ContentType "application/json" -UseBasicParsing -TimeoutSec $timeoutSec
        } else {
            $r = Invoke-WebRequest -Uri $url -Method $method -UseBasicParsing -TimeoutSec $timeoutSec
        }
        return @{ code = [int]$r.StatusCode; text = [string]$r.Content }
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
            return @{ code = $code; text = $txt }
        }
        return @{ code = 0; text = $_.Exception.Message }
    } catch {
        return @{ code = 0; text = $_.Exception.Message }
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

Write-Output ""
if ($script:Failures -eq 0) {
    Write-Output "ALL TESTS PASSED"
} else {
    Write-Output ("FAILED ASSERTIONS: " + $script:Failures)
}
exit $script:Failures
