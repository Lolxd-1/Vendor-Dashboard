<#
.SYNOPSIS
    QuickVerse 2-min shop setup: dashboard shortcut + print agent v1.4.0 (EPSON TM-T82X, no Node).

.DESCRIPTION
    One guy, 2 mins per shop, zero cost:
      1. Verifies Epson/thermal printer queue exists (warns with driver hint if not)
      2. Installs print-agent to C:\QuickVerse\print-agent (copies server.js + launchers)
      3. Registers Task Scheduler at logon (hidden, reliable) + Startup VBS fallback
      4. Starts agent now, verifies /status v1.4.0 + /printers
      5. Reuses Install-VendorDashboard.ps1 steps: Chrome --app shortcut, autoplay policy, NoSleep
      6. Prints 42-col self-test slip + PASS/FAIL checklist

.EXAMPLE
    Vercel production (HTTPS, proxy to HTTP backend - default path):
    .\Install-QuickVerse.ps1 -SiteUrl "https://vendor-dashboard-quickverse.vercel.app/" -AddToStartup -NoSleep

.EXAMPLE
    HTTP interim (same-origin serve from backend host):
    .\Install-QuickVerse.ps1 -SiteUrl "http://prd.quickverse.in/vendor/" -AddToStartup -NoSleep

.EXAMPLE
    Local test: .\Install-QuickVerse.ps1 -SiteUrl "http://localhost:5173" -AgentSource "C:\dev\print-agent"
#>

[CmdletBinding()]
param(
    [string] $SiteUrl = "https://vendor-dashboard-quickverse.vercel.app/",
    [string] $AgentSource = "",
    [string] $AgentDest = "C:\QuickVerse\print-agent",
    [string] $ShortcutName = "QuickVerse Vendor",
    [string] $ExpectedPrinter = "EPSON TM-T82X Receipt",
    [switch] $AddToStartup,
    [switch] $NoSleep,
    [switch] $SkipPolicy,
    [switch] $SkipPrintTest,
    # Signed auto-update check, twice a day. A PC that is off at these times
    # checks as soon as it is next on (StartWhenAvailable).
    [string] $UpdateMorning = "08:00",
    [string] $UpdateNight = "23:30"
)

$ErrorActionPreference = 'Stop'
$ExpectedAgentVersion = "1.4.0"
function Write-Step ($m) { Write-Host "`n==> $m" -ForegroundColor Cyan }
function Write-Ok ($m) { Write-Host "    [ok]   $m" -ForegroundColor Green }
function Write-Warn2 ($m) { Write-Host "    [warn] $m" -ForegroundColor Yellow }
function Write-Fail ($m) { Write-Host "    [fail] $m" -ForegroundColor Red }

$IsAdmin = ([Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
Write-Host ""
Write-Host "  QuickVerse Shop Setup v$ExpectedAgentVersion (no Node needed)" -ForegroundColor White
Write-Host "  Site: $SiteUrl"
Write-Host "  Admin: $IsAdmin"

if (-not $AgentSource) {
    $AgentSource = Join-Path $PSScriptRoot "..\print-agent"
    if (-not (Test-Path $AgentSource)) { $AgentSource = Join-Path (Get-Location) "print-agent" }
}
if (-not (Test-Path (Join-Path $AgentSource "agent.ps1"))) {
    Write-Fail "print-agent/agent.ps1 not found at $AgentSource. Run from repo root or pass -AgentSource."
    exit 1
}

# -- 0. PowerShell check (built into every Windows - nothing to install) --
Write-Step "Checking Windows PowerShell (agent is pure PowerShell, no Node needed)"
try {
    Write-Ok "PowerShell $($PSVersionTable.PSVersion) - nothing to install"
} catch {
    Write-Fail "PowerShell not found - this Windows is too old."
    exit 1
}

# -- 1. Printer check --
Write-Step "Checking printer queues"
$printers = @()
try { $printers = @(Get-Printer | Select-Object -ExpandProperty Name) } catch { Write-Warn2 $_.Exception.Message }
if ($printers -contains $ExpectedPrinter) {
    Write-Ok "Found '$ExpectedPrinter'"
} else {
    Write-Warn2 "Expected '$ExpectedPrinter' not found. Found: $($printers -join ' | ')"
    Write-Warn2 "Install 'EPSON Advanced Printer Driver 6 for TM-T82X', paper 80mm, then re-run Test Print."
    Write-Warn2 "Continuing anyway - dashboard lets you pick any queue from the detected list."
}

# -- 2. Install agent files --
Write-Step "Installing print agent to $AgentDest"
# A running agent keeps port 1818, so the new copy would exit "Already running"
# and the OLD version would keep printing. Stop it before replacing the files.
try { Stop-ScheduledTask -TaskName "QuickVerse Print Agent" -ErrorAction SilentlyContinue } catch {}
try {
    Get-CimInstance Win32_Process -Filter "Name='powershell.exe'" -ErrorAction Stop |
        Where-Object { $_.CommandLine -match 'agent\.ps1' -and $_.ProcessId -ne $PID } |
        ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue; Write-Ok "Stopped running agent (pid $($_.ProcessId))" }
} catch { Write-Warn2 "Could not stop a running agent: $($_.Exception.Message)" }
New-Item -ItemType Directory -Path $AgentDest -Force | Out-Null
Copy-Item (Join-Path $AgentSource "agent.ps1") $AgentDest -Force
Copy-Item (Join-Path $AgentSource "start-agent.bat") $AgentDest -Force
Copy-Item (Join-Path $AgentSource "start-agent.vbs") $AgentDest -Force
Copy-Item (Join-Path $AgentSource "updater.ps1") $AgentDest -Force
Copy-Item (Join-Path $AgentSource "update-agent.vbs") $AgentDest -Force
Write-Ok "Agent files copied (pure PowerShell - no Node, no npm)"

# -- 3. Task Scheduler (primary): at logon + watchdog every minute --
Write-Step "Registering auto-start (Task Scheduler)"
$taskOk = $false
try {
    # Launched through start-agent.vbs: fully hidden, so there is no console
    # window for staff to close (closing it used to kill the agent), and the
    # VBS waits on the agent, so the task shows Running exactly while it lives.
    $action = New-ScheduledTaskAction -Execute "wscript.exe" -Argument "`"$AgentDest\start-agent.vbs`"" -WorkingDirectory $AgentDest
    # -User: THIS Windows user's logon. An any-user logon trigger needs
    # Administrator, so a normal double-click of Start-Setup.bat never got the
    # task at all. Watchdog: every minute, forever - a no-op while the agent
    # runs (IgnoreNew), and brings it back within a minute if it was killed.
    $triggers = @(
        (New-ScheduledTaskTrigger -AtLogOn -User ([Security.Principal.WindowsIdentity]::GetCurrent().Name)),
        (New-ScheduledTaskTrigger -Once -At (Get-Date).Date -RepetitionInterval (New-TimeSpan -Minutes 1))
    )
    # ExecutionTimeLimit 0 = never. The default (72h) stops the agent on a PC left on for 3 days.
    $settings = New-ScheduledTaskSettingsSet -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -StartWhenAvailable -RestartCount 3 -RestartInterval (New-TimeSpan -Minutes 1) -ExecutionTimeLimit ([TimeSpan]::Zero) -MultipleInstances IgnoreNew
    Register-ScheduledTask -TaskName "QuickVerse Print Agent" -Action $action -Trigger $triggers -Settings $settings -Description "QuickVerse silent 80mm print agent v$ExpectedAgentVersion (no Node)" -Force -ErrorAction Stop | Out-Null
    $taskOk = $true
    Write-Ok "Scheduled task 'QuickVerse Print Agent' registered (hidden, at logon + restarts within 1 min if stopped)"
} catch {
    Write-Warn2 "Task Scheduler failed: $($_.Exception.Message) - Startup VBS fallback will cover it."
}

# -- 3b. Startup VBS fallback: only when the task could not be registered.
#        Next to the task it would race it at logon, and an agent started
#        outside the task is one the watchdog cannot see.
$startupLnk = Join-Path "$env:APPDATA\Microsoft\Windows\Start Menu\Programs\Startup" "QuickVerse Print Agent.lnk"
if ($taskOk) {
    if (Test-Path -LiteralPath $startupLnk) {
        try { Remove-Item -LiteralPath $startupLnk -Force; Write-Ok "Old Startup shortcut removed (the task covers it)" } catch { Write-Warn2 "Could not remove old Startup shortcut: $($_.Exception.Message)" }
    }
} else {
    try {
        $ws = New-Object -ComObject WScript.Shell
        $lnk = $ws.CreateShortcut($startupLnk)
        $lnk.TargetPath = "wscript.exe"
        $lnk.Arguments = "`"$AgentDest\start-agent.vbs`""
        $lnk.WorkingDirectory = $AgentDest
        $lnk.Description = "QuickVerse print agent (fallback auto-start)"
        $lnk.Save()
        Write-Ok "Startup fallback shortcut created"
    } catch { Write-Warn2 "Startup shortcut failed: $($_.Exception.Message)" }
}

# -- 3c. Auto-update: signed check twice a day (updater.ps1) --
Write-Step "Registering agent auto-update (daily at $UpdateMorning and $UpdateNight)"
try {
    $uAction = New-ScheduledTaskAction -Execute "wscript.exe" -Argument "`"$AgentDest\update-agent.vbs`"" -WorkingDirectory $AgentDest
    $uTriggers = @((New-ScheduledTaskTrigger -Daily -At $UpdateMorning), (New-ScheduledTaskTrigger -Daily -At $UpdateNight))
    $uSettings = New-ScheduledTaskSettingsSet -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -StartWhenAvailable -ExecutionTimeLimit (New-TimeSpan -Minutes 10)
    Register-ScheduledTask -TaskName "QuickVerse Agent Updater" -Action $uAction -Trigger $uTriggers -Settings $uSettings -Description "Installs signed QuickVerse print agent updates (keeps the old agent on any failure)" -Force | Out-Null
    Write-Ok "Scheduled task 'QuickVerse Agent Updater' registered"
} catch {
    Write-Warn2 "Auto-update task failed: $($_.Exception.Message) - printing works, updates will need a re-install."
}

# -- 4. Start agent now + verify --
Write-Step "Starting agent + verifying"
try { Start-ScheduledTask -TaskName "QuickVerse Print Agent" -ErrorAction SilentlyContinue } catch {}
# Poll instead of a fixed 3s: on a slow PC the fallback below would otherwise
# start a second copy outside the task.
for ($i = 0; $i -lt 15; $i++) {
    try { if ((Invoke-RestMethod -Uri "http://127.0.0.1:1818/status" -TimeoutSec 2).online) { break } } catch { }
    Start-Sleep -Seconds 1
}
$agentOk = $false
try {
    $st = Invoke-RestMethod -Uri "http://127.0.0.1:1818/status" -TimeoutSec 5
    if ($st.online) {
        $agentOk = $true
        if ($st.version -eq $ExpectedAgentVersion) { Write-Ok "Agent online v$($st.version)" }
        else { Write-Warn2 "Agent online but version=$($st.version) (expected $ExpectedAgentVersion) - continuing anyway" }
    }
} catch {
    Write-Warn2 "Task start didn't respond - launching hidden fallback..."
    Start-Process -FilePath "powershell.exe" -ArgumentList "-NoProfile","-ExecutionPolicy","Bypass","-File","`"$AgentDest\agent.ps1`"" -WorkingDirectory $AgentDest -WindowStyle Hidden
    Start-Sleep -Seconds 4
    try {
        $st = Invoke-RestMethod -Uri "http://127.0.0.1:1818/status" -TimeoutSec 5
        if ($st.online) { $agentOk = $true; Write-Ok "Agent online v$($st.version) (fallback)" }
    } catch { Write-Fail "Agent still offline: $($_.Exception.Message)" }
}
try {
    $pl = Invoke-RestMethod -Uri "http://127.0.0.1:1818/printers" -TimeoutSec 5
    Write-Ok "Queues: $($pl.printers -join ' | ')"
} catch { Write-Warn2 "Could not list printers: $($_.Exception.Message)" }

# -- 4b. First update check now: proves this PC can reach the release site and
#        verify its signature, and moves straight to the newest signed agent.
if ($agentOk) {
    Write-Step "Checking for agent updates (signed)"
    & powershell.exe -NoProfile -ExecutionPolicy Bypass -File "$AgentDest\updater.ps1" | ForEach-Object { Write-Host "    $_" }
    if ($LASTEXITCODE -eq 0) { Write-Ok "Update check OK - see $AgentDest\update.log" }
    else { Write-Warn2 "Update check exit $LASTEXITCODE - see $AgentDest\update.log (printing is not affected)" }
}

# -- 5. Dashboard shortcut + policy + power (reuse vendor flow) --
Write-Step "Dashboard shortcut + autoplay policy + power"
$vendorScript = Join-Path $PSScriptRoot "Install-VendorDashboard.ps1"
if (Test-Path $vendorScript) {
    # Hashtable splat binds BY NAME (array splat would bind positionally and break).
    $vdArgs = @{ SiteUrl = $SiteUrl; ShortcutName = $ShortcutName }
    if ($AddToStartup) { $vdArgs.AddToStartup = $true }
    if ($NoSleep) { $vdArgs.NoSleep = $true }
    if ($SkipPolicy) { $vdArgs.SkipPolicy = $true }
    & $vendorScript @vdArgs
} else {
    Write-Warn2 "Install-VendorDashboard.ps1 not found next to this script - skipping shortcut/policy."
}

# -- 6. 42-col self-test --
if (-not $SkipPrintTest -and $agentOk) {
    Write-Step "Printing 42-col self-test (should be ONE line for the 123... line)"
    $test = @"
------------------------------------------
         *** QuickVerse ***
          SHOP SELF-TEST
------------------------------------------
123456789012345678901234567890123456789012
         should be one line
------------------------------------------
"@
    $realPrinters = @()
    if ($pl -and $pl.real) { $realPrinters = @($pl.real) }
    $target = $null
    if ($printers -contains $ExpectedPrinter) { $target = $ExpectedPrinter }
    elseif ($realPrinters.Count -gt 0) { $target = $realPrinters[0] }
    if ($target) {
        try {
            $body = @{ printer = $target; text = $test } | ConvertTo-Json
            $r = Invoke-RestMethod -Uri "http://127.0.0.1:1818/print" -Method POST -Body $body -ContentType "application/json" -TimeoutSec 20
            Write-Ok "Self-test sent to '$target' ($r). Check: 123-line is ONE line, columns aligned."
        } catch { Write-Fail "Self-test print failed: $($_.Exception.Message)" }
    } else { Write-Warn2 "No printer queue found - skipping test print." }
}

Write-Host ""
Write-Host "  Done. 2-min checklist:" -ForegroundColor White
Write-Host "   1. Dashboard shortcut '$ShortcutName' opens $SiteUrl"
Write-Host "   2. Printer modal: pick queue (default EPSON TM-T82X Receipt), tick Single printer, Save"
Write-Host "   3. Test Counter Print -> aligned Bill (no wrap)"
Write-Host "   4. Reboot -> agent auto-starts (http://127.0.0.1:1818/status green)"
Write-Host ""
