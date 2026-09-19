<#
.SYNOPSIS
    Configures a vendor PC so the order dashboard can ring without interaction.

.DESCRIPTION
    Does everything Part 4 of the guide describes, in one run:

      1. Writes the Chrome and Edge AutoplayAllowlist policy for your domain
      2. Creates a desktop + Start Menu shortcut that launches the dashboard
         in an app window with the autoplay policy disabled
      3. Optionally adds it to Startup so it opens when the vendor logs in
      4. Sets the Windows power plan so the machine never sleeps on AC
      5. Verifies the result and prints what to check

    Run as administrator. Without admin it falls back to HKCU, which still
    works but only for the current user.

.EXAMPLE
    Production vendor PC (QuickVerse - the standard rollout command):
    .\Install-VendorDashboard.ps1 -SiteUrl "http://vendor.quickverse.in" -AddToStartup -NoSleep

.EXAMPLE
    .\Install-VendorDashboard.ps1 -Domain "dashboard.yourcompany.com"

.EXAMPLE
    .\Install-VendorDashboard.ps1 -Domain "dashboard.yourcompany.com" -NoSleep -AddToStartup

.EXAMPLE
    Local test on your own PC against the dev server (no production domain needed):
    .\Install-VendorDashboard.ps1 -SiteUrl "http://localhost:5173"
#>

[CmdletBinding()]
param(
    [string] $Domain = "",

    # Full origin, e.g. "http://localhost:5173". Overrides -Domain.
    # Use this for local testing; use -Domain for production.
    [string] $SiteUrl = "",

    [string] $ShortcutName = "Vendor Orders",

    [switch] $AddToStartup,

    [switch] $NoSleep,

    [switch] $SkipPolicy
)

$ErrorActionPreference = 'Stop'

if (-not $SiteUrl) {
    if (-not $Domain) { throw "Provide -Domain (e.g. vendor.quickverse.in) or -SiteUrl (e.g. http://localhost:5173)." }
    $SiteUrl = "https://$Domain"
}
$Url = $SiteUrl
$UrlHost = ([uri]$Url).Host

function Write-Step   ($m) { Write-Host "`n==> $m" -ForegroundColor Cyan }
function Write-Ok     ($m) { Write-Host "    [ok]   $m" -ForegroundColor Green }
function Write-Warn2  ($m) { Write-Host "    [warn] $m" -ForegroundColor Yellow }
function Write-Fail   ($m) { Write-Host "    [fail] $m" -ForegroundColor Red }

$IsAdmin = ([Security.Principal.WindowsPrincipal] `
            [Security.Principal.WindowsIdentity]::GetCurrent()
           ).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)

Write-Host ""
Write-Host "  Vendor Dashboard Setup" -ForegroundColor White
Write-Host "  Domain: $Url"
Write-Host "  Admin:  $IsAdmin"

if (-not $IsAdmin) {
    Write-Warn2 "Not running as administrator. Policy will be written to HKCU"
    Write-Warn2 "(current user only) instead of HKLM (all users)."
}

# ---------------------------------------------------------------------------
# 1. Autoplay allowlist policy
# ---------------------------------------------------------------------------

if (-not $SkipPolicy) {
    Write-Step "Writing autoplay allowlist policy"

    $hive = if ($IsAdmin) { "HKLM:" } else { "HKCU:" }

    $targets = @(
        @{ Name = "Chrome"; Path = "$hive\SOFTWARE\Policies\Google\Chrome\AutoplayAllowlist" },
        @{ Name = "Edge";   Path = "$hive\SOFTWARE\Policies\Microsoft\Edge\AutoplayAllowlist" }
    )

    foreach ($t in $targets) {
        try {
            if (-not (Test-Path $t.Path)) { New-Item -Path $t.Path -Force | Out-Null }

            # Numbered REG_SZ values. A bare "*" is not a valid pattern and
            # would be silently ignored, so we use explicit origin + subdomains.
            New-ItemProperty -Path $t.Path -Name "1" -Value $Url `
                             -PropertyType String -Force | Out-Null
            # Entry 2 (subdomain wildcard) only makes sense for real domains.
            # Skipped for localhost / IPs, where "[*.]localhost" would be invalid.
            if ($UrlHost -match '\.') {
                $base = $UrlHost -replace '^[^.]+\.', ''
                New-ItemProperty -Path $t.Path -Name "2" -Value "[*.]$base" `
                                 -PropertyType String -Force | Out-Null
            }

            Write-Ok "$($t.Name): $($t.Path)"
        }
        catch {
            Write-Fail "$($t.Name): $($_.Exception.Message)"
        }
    }

    Write-Warn2 "Policy applies only to NEWLY OPENED TABS."
    Write-Warn2 "Close the browser completely before testing."
}

# ---------------------------------------------------------------------------
# 2. Shortcut
# ---------------------------------------------------------------------------

Write-Step "Creating dashboard shortcut"

$chromePaths = @(
    "$env:ProgramFiles\Google\Chrome\Application\chrome.exe",
    "${env:ProgramFiles(x86)}\Google\Chrome\Application\chrome.exe",
    "$env:LOCALAPPDATA\Google\Chrome\Application\chrome.exe"
)
$chrome = $chromePaths | Where-Object { Test-Path $_ } | Select-Object -First 1

if (-not $chrome) {
    Write-Fail "Chrome not found. Install Chrome, or use the Edge path instead."
    Write-Warn2 "Edge is usually at: $env:ProgramFiles (x86)\Microsoft\Edge\Application\msedge.exe"
    exit 1
}
Write-Ok "Found Chrome at $chrome"

$profileDir = "$env:LOCALAPPDATA\VendorDashboard\profile"
New-Item -ItemType Directory -Path $profileDir -Force | Out-Null

# --autoplay-policy  : the switch this whole exercise is about
# --app              : frameless window, no address bar, vendor can't navigate away
# --user-data-dir    : isolated profile, keeps the dashboard away from personal browsing
# the three --disable-*-throttling flags keep timers running at full rate when
# the window is minimised or covered by another window
$switches = @(
    "--autoplay-policy=no-user-gesture-required"
    "--app=$Url"
    "--user-data-dir=`"$profileDir`""
    "--disable-background-timer-throttling"
    "--disable-backgrounding-occluded-windows"
    "--disable-renderer-backgrounding"
    "--noerrdialogs"
) -join " "

$shell = New-Object -ComObject WScript.Shell

$locations = @(
    [Environment]::GetFolderPath('Desktop'),
    "$env:APPDATA\Microsoft\Windows\Start Menu\Programs"
)
if ($AddToStartup) {
    $locations += "$env:APPDATA\Microsoft\Windows\Start Menu\Programs\Startup"
}

foreach ($dir in $locations) {
    try {
        $lnkPath = Join-Path $dir "$ShortcutName.lnk"
        $lnk = $shell.CreateShortcut($lnkPath)
        $lnk.TargetPath       = $chrome
        $lnk.Arguments        = $switches
        $lnk.WorkingDirectory = Split-Path $chrome
        $lnk.Description      = "Order dashboard - alerts enabled"
        $lnk.IconLocation     = "$chrome,0"
        $lnk.Save()
        Write-Ok "Shortcut: $lnkPath"
    }
    catch {
        Write-Fail "$dir : $($_.Exception.Message)"
    }
}

# ---------------------------------------------------------------------------
# 3. Power plan
# ---------------------------------------------------------------------------

if ($NoSleep) {
    Write-Step "Disabling sleep on AC power"
    try {
        powercfg /change standby-timeout-ac 0     | Out-Null   # never sleep
        powercfg /change hibernate-timeout-ac 0   | Out-Null   # never hibernate
        powercfg /change monitor-timeout-ac 30    | Out-Null   # screen off after 30m (sound still plays)
        Write-Ok "Machine will not sleep while plugged in"
        Write-Warn2 "Screen still turns off after 30 min. Audio is unaffected."
    }
    catch {
        Write-Fail $_.Exception.Message
    }
}

# ---------------------------------------------------------------------------
# 4. Verification
# ---------------------------------------------------------------------------

Write-Step "Verifying policy in registry"

foreach ($t in @(
    @{ N = "Chrome"; P = "SOFTWARE\Policies\Google\Chrome\AutoplayAllowlist" },
    @{ N = "Edge";   P = "SOFTWARE\Policies\Microsoft\Edge\AutoplayAllowlist" }
)) {
    $found = $false
    foreach ($h in @("HKLM:", "HKCU:")) {
        $p = "$h\$($t.P)"
        if (Test-Path $p) {
            $v = (Get-ItemProperty $p)."1"
            if ($v) { Write-Ok "$($t.N) [$h] -> $v"; $found = $true }
        }
    }
    if (-not $found) { Write-Warn2 "$($t.N): no policy found" }
}

# ---------------------------------------------------------------------------

Write-Host ""
Write-Host "  Done. Now verify manually:" -ForegroundColor White
Write-Host ""
Write-Host "   1. Close ALL browser windows. Check Task Manager for any"
Write-Host "      lingering chrome.exe or msedge.exe and end them."
Write-Host "   2. Open chrome://policy -> Reload policies -> filter 'Autoplay'."
Write-Host "      AutoplayAllowlist must be listed with status OK."
Write-Host "   3. Launch the '$ShortcutName' shortcut."
Write-Host "   4. Without clicking anything, open DevTools (F12) and run:"
Write-Host ""
Write-Host "        new AudioContext().state" -ForegroundColor Gray
Write-Host ""
Write-Host "      It must print 'running'. If it prints 'suspended', the"
Write-Host "      policy did not take -- check the URL pattern matches exactly"
Write-Host "      (http vs https, www vs bare domain)."
Write-Host "   5. Confirm the vendor can actually hear the test sound from"
Write-Host "      where they work. Check the Windows Volume Mixer."
Write-Host ""
