# QuickVerse installer test harness - plain PowerShell 5.1, no Pester.
# Vendor PCs have no modules, and this machine only has Pester 3.4.
# Static parse + assertions only - never runs the installer (it mutates the
# real machine: scheduled tasks, registry, Startup folder).
# Exit code = number of failed assertions (0 = all green).

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

$filesDir = Split-Path -Parent $PSScriptRoot
$repoRoot = Split-Path -Parent $filesDir
$installerPath = Join-Path $filesDir "Install-QuickVerse.ps1"
$batPath = Join-Path $repoRoot "Start-Setup.bat"

# --- TC1 - syntax. Must run before anything else: every other test would
# --- report a misleading failure if the script simply does not parse.
$tokens = $null
$errors = $null
$ast = [System.Management.Automation.Language.Parser]::ParseFile($installerPath, [ref]$tokens, [ref]$errors)
$errText = ""
if ($errors -and $errors.Count -gt 0) {
    $errText = ($errors | ForEach-Object { "line " + $_.Extent.StartLineNumber + ": " + $_.Message }) -join " | "
}
Assert-That "TC1 syntax: Install-QuickVerse.ps1 parses with zero errors" (@($errors).Count -eq 0) $errText
if (@($errors).Count -ne 0) {
    Write-Output "ABORT: Install-QuickVerse.ps1 does not parse; skipping remaining tests."
    exit 1
}

$content = Get-Content -Raw -Path $installerPath

# --- TC2 - happy: default -SiteUrl is the live host, dead URL is gone.
$paramAst = @($ast.ParamBlock.Parameters | Where-Object { $_.Name.VariablePath.UserPath -eq 'SiteUrl' })
$defaultSiteUrl = $null
if (($paramAst.Count -eq 1) -and $paramAst[0].DefaultValue) { $defaultSiteUrl = $paramAst[0].DefaultValue.Value }
Assert-That 'TC2 happy: default $SiteUrl is the live host' ($defaultSiteUrl -eq "https://vendor-dashboard-quickverse.vercel.app/") ("got [" + $defaultSiteUrl + "]")

$hasDeadUrl = $content -match "quickverse-vendor-dashboard"
Assert-That "TC2 happy: dead URL 'quickverse-vendor-dashboard' appears nowhere in the file" (-not $hasDeadUrl) "dead URL substring found in file"

# --- TC3 - reachability: the default URL is actually live.
$reachable = $false
$statusDetail = ""
try {
    $resp = Invoke-WebRequest -Uri $defaultSiteUrl -UseBasicParsing -TimeoutSec 15
    $reachable = ([int]$resp.StatusCode -eq 200)
    $statusDetail = "status " + [int]$resp.StatusCode
} catch {
    $statusDetail = $_.Exception.Message
}
Assert-That "TC3 reachability: default site URL returns HTTP 200" $reachable $statusDetail

# --- TC4 - gate: no hardcoded version comparison; $agentOk keys off .online.
$hasOldLiteral = $content -match [regex]::Escape('"1.2.0"')
Assert-That 'TC4 gate: no hardcoded literal "1.2.0" comparison remains' (-not $hasOldLiteral) "found literal 1.2.0 string in file"

$onlineGatesAgentOk = $content -match 'if\s*\(\s*\$st\.online\s*\)\s*\{\s*\$agentOk\s*=\s*\$true'
Assert-That 'TC4 gate: $agentOk is set based on $st.online, not a version equality test' $onlineGatesAgentOk "expected pattern 'if (`$st.online) { `$agentOk = `$true' not found"

# --- TC5 - consistency: Start-Setup.bat and the installer agree on the URL.
if (Test-Path $batPath) {
    $batContent = Get-Content -Raw -Path $batPath
    $sameUrl = ($null -ne $defaultSiteUrl) -and ($batContent -match [regex]::Escape($defaultSiteUrl))
    Assert-That 'TC5 consistency: Start-Setup.bat references the same site URL as the installer default' $sameUrl ("installer default [" + $defaultSiteUrl + "] not found in Start-Setup.bat")
} else {
    Assert-That 'TC5 consistency: Start-Setup.bat references the same site URL as the installer default' $false ("Start-Setup.bat not found at " + $batPath)
}

# --- TC6 - safety: self-test target selection never falls back to an
# --- arbitrary first queue (that queue is often "Microsoft Print to PDF",
# --- which pops a Save-As dialog and blocks the installer for its timeout).
$hasBareFallback = $content -match '\$printers\s*\|\s*Select-Object\s+-First\s+1'
Assert-That 'TC6 safety: self-test target selection no longer uses a bare $printers | Select-Object -First 1' (-not $hasBareFallback) 'bare fallback pattern still present'

Write-Output ""
if ($script:Failures -eq 0) {
    Write-Output "ALL TESTS PASSED"
} else {
    Write-Output ("FAILED ASSERTIONS: " + $script:Failures)
}
exit $script:Failures
