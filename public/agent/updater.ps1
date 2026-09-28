# QuickVerse Agent Updater - pure PowerShell, ZERO installs.
# Runs twice a day from Task Scheduler ("QuickVerse Agent Updater", morning +
# night). Checks the dashboard site for a newer print agent and installs it
# ONLY if it is signed with the QuickVerse release key. Anything unexpected -
# no internet, bad signature, broken file, new agent that will not start -
# leaves (or puts back) the agent that was already printing.
#
#   1. GET <BaseUrl>/manifest.json + manifest.sig   (version + SHA-256 per file)
#   2. Verify the signature with the public key below. No match -> stop.
#   3. Newer than the installed agent? Download the files, check each SHA-256
#      and that each one parses as PowerShell. Any failure -> stop.
#   4. Back up the current files, stop the agent, swap in the new agent.ps1,
#      start it, and wait for /status to report the new version.
#   5. Not healthy in time -> restore the backup and start the old agent again.
#
# Never runs downloaded code in memory: files are written to disk, verified,
# and started the same way the agent always starts (its scheduled task).
param(
    [string] $AgentDir = $PSScriptRoot,
    [string] $BaseUrl = "https://vendor-dashboard-quickverse.vercel.app/agent",
    [int] $Port = 1818,
    [string] $TaskName = "QuickVerse Print Agent",
    [int] $HealthTimeoutSec = 30,
    # Verify what is published and report, change nothing.
    [switch] $CheckOnly
)

$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'   # the PS 5.1 progress bar makes downloads crawl

# QuickVerse release public key. Only the matching private key (kept off the
# repo and off Vercel) can sign an update this script will install.
$PUBLIC_KEY_XML = '<RSAKeyValue><Modulus>2U39dRAHbnlkFvlzbqFQf1V4Q/q0Epvs16Wsxuw/wHGUYs1k95JMJLrlNem6O25jzJoGyH61QRTVY8nUmLi+owl3h7bQtg9Quj4bxoMqTdByslggLG/1z017yPXmOt6r2hUz9hgV19f6Zddib4T0+CiPVH8NlQd0WcCxAUFjugaRcTAVoBhAjMk7VuZgRjdAG9/7b1htA4ryE40/UI3gxk3BCc38ULOSMlJr4kCKaPXqMSeiZnzpwoLGbS9ZVnLaXP4z25bssn8FYsg1gLIHN8fseMOzGryPjidlHDVkJPVAIeW4Ta78rZCgxxRmxitw8besbDgt88KsWzc/Qy1/dcg9uh0Dg6Ioq/BICWLxCdksb1AuNbjIGeGasyyUosR8Cw9/9qLzzbl5yZr73gz82V/945n1Yl93QBrIRTlDgz3vhWeD6W9qFokxqNgdYRABHgc49KJ6foV407vhu7zOcnv0AHBOFGdxfmUGYSBH1pQO25GDqaDj6Muv0Jb/ctEt</Modulus><Exponent>AQAB</Exponent></RSAKeyValue>'

# Files an update may replace - nothing else, and never a path.
$ALLOWED_FILES = @('agent.ps1', 'updater.ps1')

$EXIT_OK = 0; $EXIT_BUSY = 2; $EXIT_REJECTED = 3; $EXIT_ROLLED_BACK = 4; $EXIT_FAILED = 5; $EXIT_CONFIG = 6

$logPath = Join-Path $AgentDir "update.log"
function Write-UpdateLog($msg) {
    # Never throws - logging must never break the update or the rollback.
    try {
        if ((Test-Path -LiteralPath $logPath) -and ((Get-Item -LiteralPath $logPath).Length -gt 262144)) {
            $keep = Get-Content -LiteralPath $logPath -Tail 500
            Set-Content -LiteralPath $logPath -Value $keep -Encoding UTF8
        }
        $line = "[$(Get-Date -Format 'yyyy-MM-dd HH:mm:ss')] $msg"
        Add-Content -LiteralPath $logPath -Value $line -Encoding UTF8
        Write-Output $line
    } catch { }
}

function Get-FileVersion($path) {
    if (-not (Test-Path -LiteralPath $path)) { return $null }
    $m = [regex]::Match((Get-Content -Raw -LiteralPath $path), '(?m)^\$AGENT_VERSION = "([0-9]+(\.[0-9]+){1,3})"')
    if ($m.Success) { return $m.Groups[1].Value }
    return $null
}

function Get-RunningVersion() {
    try { return [string](Invoke-RestMethod -Uri "http://127.0.0.1:$Port/status" -TimeoutSec 3).version } catch { return $null }
}

function Get-Sha256Hex([byte[]] $bytes) {
    $sha = [System.Security.Cryptography.SHA256]::Create()
    try { return (($sha.ComputeHash($bytes) | ForEach-Object { $_.ToString('x2') }) -join '') } finally { $sha.Dispose() }
}

function Get-Bytes($url, $outFile) {
    # Cache-buster so no proxy or CDN edge can hand back yesterday's manifest.
    $sep = '?'; if ($url.Contains('?')) { $sep = '&' }
    Invoke-WebRequest -Uri ($url + $sep + 't=' + [DateTime]::UtcNow.Ticks) -UseBasicParsing -TimeoutSec 30 -OutFile $outFile
    return [System.IO.File]::ReadAllBytes($outFile)
}

function Test-ParsesAsPowerShell($path) {
    $tokens = $null; $errors = $null
    [void][System.Management.Automation.Language.Parser]::ParseFile($path, [ref]$tokens, [ref]$errors)
    return (@($errors).Count -eq 0)
}

function Get-AgentProcesses() {
    # This install's agent: launched by full path (scheduled task) or by
    # relative path from its own folder (start-agent.vbs / .bat).
    $full = [regex]::Escape((Join-Path $AgentDir 'agent.ps1'))
    @(Get-CimInstance Win32_Process -Filter "Name='powershell.exe'" |
        Where-Object {
            $_.ProcessId -ne $PID -and $_.CommandLine -and (
                $_.CommandLine -match $full -or
                $_.CommandLine -match '-File\s+"?agent\.ps1"?(\s|$)'
            )
        })
}

function Stop-Agent() {
    try { Stop-ScheduledTask -TaskName $TaskName -ErrorAction SilentlyContinue } catch { }
    foreach ($p in (Get-AgentProcesses)) {
        try { Stop-Process -Id $p.ProcessId -Force -ErrorAction SilentlyContinue } catch { }
    }
    $deadline = (Get-Date).AddSeconds(15)
    while ((Get-Date) -lt $deadline) {
        if (-not (Get-RunningVersion)) { return $true }
        Start-Sleep -Milliseconds 300
    }
    return $false
}

function Start-Agent() {
    $started = $false
    try { Start-ScheduledTask -TaskName $TaskName -ErrorAction Stop; $started = $true } catch { }
    if ($started) {
        $deadline = (Get-Date).AddSeconds(15)
        while ((Get-Date) -lt $deadline) {
            if (Get-RunningVersion) { return }
            Start-Sleep -Milliseconds 500
        }
    }
    # No task (or it did not come up): start it the way the installer's fallback does.
    Write-UpdateLog "agent task did not start it - launching hidden fallback"
    Start-Process -FilePath "powershell.exe" -WindowStyle Hidden -WorkingDirectory $AgentDir `
        -ArgumentList @("-NoProfile", "-ExecutionPolicy", "Bypass", "-File", "`"$(Join-Path $AgentDir 'agent.ps1')`"", "-Port", "$Port")
}

function Wait-ForVersion($version) {
    $deadline = (Get-Date).AddSeconds($HealthTimeoutSec)
    while ((Get-Date) -lt $deadline) {
        if ((Get-RunningVersion) -eq $version) { return $true }
        Start-Sleep -Milliseconds 500
    }
    return $false
}

# ---------------------------------------------------------------------------

$mutex = New-Object System.Threading.Mutex($false, "Local\QuickVerseAgentUpdater$Port")
$haveMutex = $false
try { $haveMutex = $mutex.WaitOne(0, $false) } catch [System.Threading.AbandonedMutexException] { $haveMutex = $true }
if (-not $haveMutex) { Write-UpdateLog "another update check is running - exiting"; exit $EXIT_BUSY }

$staging = Join-Path $AgentDir "update-staging"
try {
    # Https only - a plain-http manifest could be swapped on the way. Loopback
    # is allowed so the test harness can serve a fake release.
    $uri = [Uri]$BaseUrl
    if ($uri.Scheme -ne 'https' -and -not $uri.IsLoopback) {
        Write-UpdateLog "REFUSED: update URL must be https ($BaseUrl)"
        exit $EXIT_CONFIG
    }
    $keyXml = $PUBLIC_KEY_XML
    if (-not $keyXml.StartsWith('<RSAKeyValue>')) {
        Write-UpdateLog "REFUSED: no release public key in updater.ps1"
        exit $EXIT_CONFIG
    }
    # Older .NET defaults can leave TLS 1.2 off; Vercel requires it.
    try { [Net.ServicePointManager]::SecurityProtocol = [Net.ServicePointManager]::SecurityProtocol -bor [Net.SecurityProtocolType]::Tls12 } catch { }

    $installed = Get-FileVersion (Join-Path $AgentDir 'agent.ps1')
    if (-not $installed) { $installed = '0.0.0' }

    if (Test-Path -LiteralPath $staging) { Remove-Item -LiteralPath $staging -Recurse -Force }
    New-Item -ItemType Directory -Path $staging -Force | Out-Null
    $base = $BaseUrl.TrimEnd('/')

    # 1. Manifest + signature.
    try {
        $manifestBytes = Get-Bytes "$base/manifest.json" (Join-Path $staging 'manifest.json')
        $sigText = [System.Text.Encoding]::ASCII.GetString((Get-Bytes "$base/manifest.sig" (Join-Path $staging 'manifest.sig'))).Trim()
    } catch {
        Write-UpdateLog "check failed (network): $($_.Exception.Message) - keeping v$installed"
        exit $EXIT_FAILED
    }

    # A missing file on the site comes back as the dashboard's web page, not a 404.
    if ($manifestBytes.Length -eq 0 -or [char]$manifestBytes[0] -ne '{') {
        Write-UpdateLog "no release published at $base (got a web page, not a manifest) - keeping v$installed"
        exit $EXIT_FAILED
    }

    # 2. Signature, before anything in the manifest is trusted.
    $sigOk = $false
    try {
        $rsa = New-Object System.Security.Cryptography.RSACryptoServiceProvider
        $rsa.FromXmlString($keyXml)
        $sigOk = $rsa.VerifyData($manifestBytes, [System.Security.Cryptography.CryptoConfig]::MapNameToOID('SHA256'), [Convert]::FromBase64String($sigText))
    } catch { $sigOk = $false }
    if (-not $sigOk) {
        Write-UpdateLog "REJECTED: manifest signature does not match the QuickVerse release key - keeping v$installed"
        exit $EXIT_REJECTED
    }

    try {
        $manifest = [System.Text.Encoding]::UTF8.GetString($manifestBytes) | ConvertFrom-Json
        $available = [string]$manifest.version
        [void][Version]$available
    } catch {
        Write-UpdateLog "REJECTED: manifest is not valid - keeping v$installed"
        exit $EXIT_REJECTED
    }
    $names = @($manifest.files.PSObject.Properties | ForEach-Object { $_.Name })
    if (-not ($names -contains 'agent.ps1') -or @($names | Where-Object { $ALLOWED_FILES -notcontains $_ }).Count -gt 0) {
        Write-UpdateLog "REJECTED: manifest lists unexpected files ($($names -join ', ')) - keeping v$installed"
        exit $EXIT_REJECTED
    }

    $isNewer = ([Version]$available -gt [Version]$installed)
    if (-not $isNewer -and -not $CheckOnly) {
        Write-UpdateLog "up to date (installed v$installed, published v$available)"
        exit $EXIT_OK
    }
    $failedPath = Join-Path $AgentDir "update-failed.txt"
    if (-not $CheckOnly -and (Test-Path -LiteralPath $failedPath) -and ((Get-Content -Raw -LiteralPath $failedPath).Trim() -eq $available)) {
        Write-UpdateLog "skipping v$available - it failed its health check here before; waiting for a newer release"
        exit $EXIT_OK
    }

    # 3. Files: hash + parse, all of them, before touching the install.
    foreach ($name in $names) {
        $path = Join-Path $staging $name
        try { $bytes = Get-Bytes "$base/$name" $path } catch {
            Write-UpdateLog "check failed (network, $name): $($_.Exception.Message) - keeping v$installed"
            exit $EXIT_FAILED
        }
        $want = ([string]$manifest.files.$name).ToLowerInvariant()
        if ((Get-Sha256Hex $bytes) -ne $want) {
            Write-UpdateLog "REJECTED: $name does not match its signed SHA-256 - keeping v$installed"
            exit $EXIT_REJECTED
        }
        if (-not (Test-ParsesAsPowerShell $path)) {
            Write-UpdateLog "REJECTED: $name does not parse as PowerShell - keeping v$installed"
            exit $EXIT_REJECTED
        }
    }
    if ((Get-FileVersion (Join-Path $staging 'agent.ps1')) -ne $available) {
        Write-UpdateLog "REJECTED: agent.ps1 version does not match the manifest (v$available) - keeping v$installed"
        exit $EXIT_REJECTED
    }

    if ($CheckOnly) {
        Write-UpdateLog "CHECK OK: v$available published and verified (signature + $($names.Count) file hashes); installed v$installed"
        exit $EXIT_OK
    }

    # 4. Swap. Back up first so there is always something to go back to.
    Write-UpdateLog "updating v$installed -> v$available"
    $backup = Join-Path $AgentDir "previous"
    New-Item -ItemType Directory -Path $backup -Force | Out-Null
    foreach ($name in $ALLOWED_FILES) {
        $cur = Join-Path $AgentDir $name
        if (Test-Path -LiteralPath $cur) { Copy-Item -LiteralPath $cur -Destination (Join-Path $backup $name) -Force }
    }

    # The agent answers one request at a time, so once this /status answers,
    # no print is in the middle of being handed to the spooler.
    [void](Get-RunningVersion)
    if (-not (Stop-Agent)) {
        Write-UpdateLog "could not stop the running agent - update postponed, v$installed keeps printing"
        exit $EXIT_FAILED
    }
    Copy-Item -LiteralPath (Join-Path $staging 'agent.ps1') -Destination (Join-Path $AgentDir 'agent.ps1') -Force
    Start-Agent

    if (Wait-ForVersion $available) {
        # The agent is proven; only now replace the updater (this run is already
        # loaded in memory, so overwriting its own file is safe).
        if ($names -contains 'updater.ps1') {
            Copy-Item -LiteralPath (Join-Path $staging 'updater.ps1') -Destination (Join-Path $AgentDir 'updater.ps1') -Force
        }
        if (Test-Path -LiteralPath $failedPath) { Remove-Item -LiteralPath $failedPath -Force }
        Write-UpdateLog "UPDATED to v$available - agent healthy on port $Port"
        exit $EXIT_OK
    }

    # 5. Rollback.
    Write-UpdateLog "v$available did not come up healthy in ${HealthTimeoutSec}s - rolling back to v$installed"
    [void](Stop-Agent)
    Copy-Item -LiteralPath (Join-Path $backup 'agent.ps1') -Destination (Join-Path $AgentDir 'agent.ps1') -Force
    Set-Content -LiteralPath $failedPath -Value $available -Encoding ASCII
    Start-Agent
    if (Wait-ForVersion $installed) { Write-UpdateLog "ROLLED BACK - v$installed is printing again" }
    else { Write-UpdateLog "ROLLBACK: restored v$installed files but it did not answer in ${HealthTimeoutSec}s - check this PC" }
    exit $EXIT_ROLLED_BACK
} catch {
    Write-UpdateLog "update check error: $($_.Exception.Message)"
    exit $EXIT_FAILED
} finally {
    try { if (Test-Path -LiteralPath $staging) { Remove-Item -LiteralPath $staging -Recurse -Force } } catch { }
    if ($haveMutex) { try { $mutex.ReleaseMutex() } catch { } }
    $mutex.Dispose()
}
