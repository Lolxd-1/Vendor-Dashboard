<#
.SYNOPSIS
    QuickVerse 2-min shop setup: dashboard shortcut + print agent v1.2.0 (EPSON TM-T82X, no Node).

.DESCRIPTION
    One guy, 2 mins per shop, zero cost:
      1. Verifies Epson/thermal printer queue exists (warns with driver hint if not)
      2. Installs print-agent to C:\QuickVerse\print-agent (copies server.js + launchers)
      3. Registers Task Scheduler at logon (hidden, reliable) + Startup VBS fallback
      4. Starts agent now, verifies /status v1.1.0 + /printers
      5. Reuses Install-VendorDashboard.ps1 steps: Chrome --app shortcut, autoplay policy, NoSleep
      6. Prints 42-col self-test slip + PASS/FAIL checklist

.EXAMPLE
    Vercel production (HTTPS, proxy to HTTP backend - default path):
    .\Install-QuickVerse.ps1 -SiteUrl "https://<your-app>.vercel.app/" -AddToStartup -NoSleep

.EXAMPLE
    HTTP interim (same-origin serve from backend host):
    .\Install-QuickVerse.ps1 -SiteUrl "http://prd.quickverse.in/vendor/" -AddToStartup -NoSleep

.EXAMPLE
    Local test: .\Install-QuickVerse.ps1 -SiteUrl "http://localhost:5173" -AgentSource "C:\dev\print-agent"
#>

[CmdletBinding()]
param(
    [string] $SiteUrl = "https://quickverse-vendor-dashboard.vercel.app/",
    [string] $AgentSource = "",
    [string] $AgentDest = "C:\QuickVerse\print-agent",
    [string] $ShortcutName = "QuickVerse Vendor",
    [string] $ExpectedPrinter = "EPSON TM-T82X Receipt",
    [switch] $AddToStartup,
    [switch] $NoSleep,
    [switch] $SkipPolicy,
    [switch] $SkipPrintTest
)

$ErrorActionPreference = 'Stop'
function Write-Step ($m) { Write-Host "`n==> $m" -ForegroundColor Cyan }
function Write-Ok ($m) { Write-Host "    [ok]   $m" -ForegroundColor Green }
function Write-Warn2 ($m) { Write-Host "    [warn] $m" -ForegroundColor Yellow }
function Write-Fail ($m) { Write-Host "    [fail] $m" -ForegroundColor Red }

$IsAdmin = ([Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
Write-Host ""
Write-Host "  QuickVerse Shop Setup v1.2.0 (no Node needed)" -ForegroundColor White
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
New-Item -ItemType Directory -Path $AgentDest -Force | Out-Null
Copy-Item (Join-Path $AgentSource "agent.ps1") $AgentDest -Force
Copy-Item (Join-Path $AgentSource "start-agent.bat") $AgentDest -Force
Copy-Item (Join-Path $AgentSource "start-agent.vbs") $AgentDest -Force
Write-Ok "Agent files copied (pure PowerShell - no Node, no npm)"

# -- 3. Task Scheduler at logon (primary) --
Write-Step "Registering auto-start (Task Scheduler)"
try {
    $action = New-ScheduledTaskAction -Execute "powershell.exe" -Argument "-NoProfile -ExecutionPolicy Bypass -File `"$AgentDest\agent.ps1`"" -WorkingDirectory $AgentDest
    $trigger = New-ScheduledTaskTrigger -AtLogOn
    $settings = New-ScheduledTaskSettingsSet -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -StartWhenAvailable -RestartCount 3 -RestartInterval (New-TimeSpan -Minutes 1)
    Register-ScheduledTask -TaskName "QuickVerse Print Agent" -Action $action -Trigger $trigger -Settings $settings -Description "QuickVerse silent 80mm print agent v1.2.0 (no Node)" -Force | Out-Null
    Write-Ok "Scheduled task 'QuickVerse Print Agent' registered"
} catch {
    Write-Warn2 "Task Scheduler failed: $($_.Exception.Message) - Startup VBS fallback will cover it."
}

# -- 3b. Startup VBS fallback --
try {
    $startup = "$env:APPDATA\Microsoft\Windows\Start Menu\Programs\Startup"
    $ws = New-Object -ComObject WScript.Shell
    $lnk = $ws.CreateShortcut((Join-Path $startup "QuickVerse Print Agent.lnk"))
    $lnk.TargetPath = "wscript.exe"
    $lnk.Arguments = "`"$AgentDest\start-agent.vbs`""
    $lnk.WorkingDirectory = $AgentDest
    $lnk.Description = "QuickVerse print agent (fallback auto-start)"
    $lnk.Save()
    Write-Ok "Startup fallback shortcut created"
} catch { Write-Warn2 "Startup shortcut failed: $($_.Exception.Message)" }

# -- 4. Start agent now + verify --
Write-Step "Starting agent + verifying"
try { Start-ScheduledTask -TaskName "QuickVerse Print Agent" -ErrorAction SilentlyContinue } catch {}
Start-Sleep -Seconds 3
$agentOk = $false
try {
    $st = Invoke-RestMethod -Uri "http://127.0.0.1:1818/status" -TimeoutSec 5
    if ($st.online -and $st.version -eq "1.2.0") { $agentOk = $true; Write-Ok "Agent online v1.2.0" }
    else { Write-Warn2 "Agent responded but version=$($st.version) (expected 1.2.0)" }
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
    $target = if ($printers -contains $ExpectedPrinter) { $ExpectedPrinter } else { $printers | Select-Object -First 1 }
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
