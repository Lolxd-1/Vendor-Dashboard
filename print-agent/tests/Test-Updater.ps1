# QuickVerse auto-updater END-TO-END test - plain PowerShell 5.1, no Pester.
# Real processes, real scheduled task, real HTTP, real signatures - all in a
# temp folder on ports $AgentPort / $ServerPort, so the production agent on
# 1818 and its "QuickVerse Print Agent" task are never touched (asserted).
# Uses tools/agent-release/Publish-AgentRelease.ps1 to build releases, so the
# publish tool is tested together with the updater.
# Exit code = number of failed assertions (0 = all green).
param(
    [int] $AgentPort = 18191,
    [int] $ServerPort = 18192
)

$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'

$script:Failures = 0
function Assert-That($name, $cond, $detail) {
    if ($cond) { Write-Output ("PASS  " + $name) }
    else { $script:Failures = $script:Failures + 1; Write-Output ("FAIL  " + $name + " -- " + $detail) }
}

$agentSrcDir = Split-Path -Parent $PSScriptRoot
$repoRoot = Split-Path -Parent $agentSrcDir
$publishTool = Join-Path $repoRoot "tools\agent-release\Publish-AgentRelease.ps1"
$realAgentText = [System.IO.File]::ReadAllText((Join-Path $agentSrcDir "agent.ps1"))
$realUpdaterText = [System.IO.File]::ReadAllText((Join-Path $agentSrcDir "updater.ps1"))
$utf8 = New-Object System.Text.UTF8Encoding($false)

function Get-Status($p) {
    try { return (Invoke-RestMethod -Uri "http://127.0.0.1:$p/status" -TimeoutSec 3) } catch { return $null }
}
function Get-Sha256Hex([byte[]] $bytes) {
    $sha = [System.Security.Cryptography.SHA256]::Create()
    try { return (($sha.ComputeHash($bytes) | ForEach-Object { $_.ToString('x2') }) -join '') } finally { $sha.Dispose() }
}
function Get-FileHashHex($path) { return Get-Sha256Hex ([System.IO.File]::ReadAllBytes($path)) }

# Safety: the updater also stops agents launched by RELATIVE path (the VBS
# fallback). If this machine has one running, the test could stop it - refuse.
$relative = @(Get-CimInstance Win32_Process -Filter "Name='powershell.exe'" | Where-Object { $_.CommandLine -match '-File\s+"?agent\.ps1"?(\s|$)' })
if ($relative.Count -gt 0) {
    Write-Output "ABORT: an agent started by relative path is running on this PC (pid $($relative[0].ProcessId)); the test could stop it."
    exit 1
}
foreach ($p in @($AgentPort, $ServerPort)) {
    if (Get-Status $p) { Write-Output "ABORT: port $p is in use."; exit 1 }
}
$prodBefore = Get-Status 1818
$prodTaskBefore = $null
try { $prodTaskBefore = (Get-ScheduledTask -TaskName "QuickVerse Print Agent" -ErrorAction Stop).State } catch { }

$T = Join-Path $env:TEMP ("qv-updater-e2e-" + [guid]::NewGuid().ToString('N').Substring(0, 8))
$install = Join-Path $T "install"
$serverDir = Join-Path $T "server"
$srcDir = Join-Path $T "src"
New-Item -ItemType Directory -Path $install, $serverDir, $srcDir -Force | Out-Null
$taskName = "QuickVerse Updater E2E " + (Split-Path -Leaf $T)
$serverProc = $null

# --- keys: the "release" key the installed updater trusts, and an attacker's.
function New-KeyFile($path) {
    $rsa = New-Object System.Security.Cryptography.RSACryptoServiceProvider(2048)
    [System.IO.File]::WriteAllText($path, $rsa.ToXmlString($true), $utf8)
    return $rsa.ToXmlString($false)
}
$releaseKey = Join-Path $T "release-key.xml"
$attackerKey = Join-Path $T "attacker-key.xml"
$releasePub = New-KeyFile $releaseKey
$attackerPub = New-KeyFile $attackerKey

function New-UpdaterText($pub, $marker) {
    $line = "`$PUBLIC_KEY_XML = '$pub'"
    $t = [regex]::Replace($realUpdaterText, "(?m)^\`$PUBLIC_KEY_XML = '[^'\r\n]*'(?=\r?$)", { param($m) $line })
    if ($marker) { $t = $t + "`r`n# $marker`r`n" }
    return $t
}
function New-AgentText($version, $extra) {
    $line = "`$AGENT_VERSION = `"$version`""
    if ($extra) { $line = $line + "; " + $extra }
    return [regex]::Replace($realAgentText, '(?m)^\$AGENT_VERSION = "[^"]*"', { param($m) $line })
}
# Real publish tool: signs with $key, checks the updater embeds the matching key.
function Publish($agentText, $updaterText, $key) {
    [System.IO.File]::WriteAllText((Join-Path $srcDir "agent.ps1"), $agentText, $utf8)
    [System.IO.File]::WriteAllText((Join-Path $srcDir "updater.ps1"), $updaterText, $utf8)
    $out = & powershell.exe -NoProfile -ExecutionPolicy Bypass -File $publishTool -AgentPath (Join-Path $srcDir "agent.ps1") -UpdaterPath (Join-Path $srcDir "updater.ps1") -OutDir $serverDir -KeyPath $key 2>&1
    if ($LASTEXITCODE -ne 0) { throw "publish failed: $out" }
}
# Hand-made release for cases the publish tool (rightly) refuses to build.
function Publish-Raw($files, $version, $key) {
    Get-ChildItem -LiteralPath $serverDir | Remove-Item -Force
    $entries = @()
    foreach ($name in $files.Keys) {
        $bytes = $utf8.GetBytes($files[$name])
        $safe = ($name -replace '[\\/:]', '_')
        [System.IO.File]::WriteAllBytes((Join-Path $serverDir $safe), $bytes)
        $entries += "    `"$($name -replace '\\', '\\')`": `"$(Get-Sha256Hex $bytes)`""
    }
    $manifest = "{`n  `"version`": `"$version`",`n  `"files`": {`n" + ($entries -join ",`n") + "`n  }`n}`n"
    $mb = $utf8.GetBytes($manifest)
    $rsa = New-Object System.Security.Cryptography.RSACryptoServiceProvider
    $rsa.FromXmlString([System.IO.File]::ReadAllText($key))
    [System.IO.File]::WriteAllBytes((Join-Path $serverDir "manifest.json"), $mb)
    [System.IO.File]::WriteAllText((Join-Path $serverDir "manifest.sig"), [Convert]::ToBase64String($rsa.SignData($mb, [System.Security.Cryptography.CryptoConfig]::MapNameToOID('SHA256'))), [System.Text.Encoding]::ASCII)
}

function Get-TestAgentPids() {
    $full = [regex]::Escape((Join-Path $install 'agent.ps1'))
    @(Get-CimInstance Win32_Process -Filter "Name='powershell.exe'" | Where-Object {
        $_.CommandLine -and ($_.CommandLine -match $full -or $_.CommandLine -match '-File\s+"?agent\.ps1"?(\s|$)')
    } | ForEach-Object { $_.ProcessId })
}
function Wait-Version($v, $sec) {
    $deadline = (Get-Date).AddSeconds($sec)
    while ((Get-Date) -lt $deadline) {
        $s = Get-Status $AgentPort
        if ($s -and $s.version -eq $v) { return $true }
        Start-Sleep -Milliseconds 300
    }
    return $false
}
function Invoke-Updater([string[]] $extra) {
    $args2 = @("-NoProfile", "-ExecutionPolicy", "Bypass", "-File", (Join-Path $install "updater.ps1"),
        "-Port", "$AgentPort", "-TaskName", $taskName, "-HealthTimeoutSec", "20") + $extra
    $out = & powershell.exe @args2 2>&1
    return @{ code = $LASTEXITCODE; out = ($out -join "`n") }
}
function Invoke-UpdaterAt($baseUrl) { return Invoke-Updater @("-AgentDir", $install, "-BaseUrl", $baseUrl) }
$base = "http://127.0.0.1:$ServerPort"

try {
    # --- fake release server (stands in for Vercel) --------------------------
    $serveScript = Join-Path $T "serve.ps1"
    @"
`$l = New-Object System.Net.HttpListener
`$l.Prefixes.Add('http://127.0.0.1:$ServerPort/')
`$l.Start()
while (`$true) {
    `$c = `$l.GetContext()
    `$name = [Uri]::UnescapeDataString(`$c.Request.Url.AbsolutePath.TrimStart('/')) -replace '[\\/:]', '_'
    `$p = Join-Path '$serverDir' `$name
    if (`$name -and (Test-Path -LiteralPath `$p -PathType Leaf)) {
        `$b = [System.IO.File]::ReadAllBytes(`$p); `$c.Response.StatusCode = 200
    } else { `$b = [System.Text.Encoding]::UTF8.GetBytes('not found'); `$c.Response.StatusCode = 404 }
    `$c.Response.ContentLength64 = `$b.Length
    `$c.Response.OutputStream.Write(`$b, 0, `$b.Length)
    `$c.Response.OutputStream.Close()
}
"@ | Set-Content -LiteralPath $serveScript -Encoding UTF8
    $serverProc = Start-Process powershell.exe -ArgumentList @("-NoProfile", "-ExecutionPolicy", "Bypass", "-File", "`"$serveScript`"") -WindowStyle Hidden -PassThru

    # --- installed state: agent v1.0.0 + updater trusting the release key ----
    $v1Agent = New-AgentText "1.0.0" $null
    $v1Updater = New-UpdaterText $releasePub $null
    [System.IO.File]::WriteAllText((Join-Path $install "agent.ps1"), $v1Agent, $utf8)
    [System.IO.File]::WriteAllText((Join-Path $install "updater.ps1"), $v1Updater, $utf8)
    $v1Hash = Get-FileHashHex (Join-Path $install "agent.ps1")

    $action = New-ScheduledTaskAction -Execute "powershell.exe" -Argument "-NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File `"$install\agent.ps1`" -Port $AgentPort" -WorkingDirectory $install
    Register-ScheduledTask -TaskName $taskName -Action $action -Settings (New-ScheduledTaskSettingsSet -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries) -Force | Out-Null
    Start-ScheduledTask -TaskName $taskName
    Assert-That "SETUP agent v1.0.0 starts from its scheduled task" (Wait-Version "1.0.0" 30) "agent never answered on $AgentPort"
    $pid0 = @(Get-TestAgentPids)

    # --- TC1 up to date -------------------------------------------------------
    Publish $v1Agent $v1Updater $releaseKey
    $r = Invoke-UpdaterAt $base
    Assert-That "TC1 same version published -> exit 0, 'up to date', agent not restarted" (($r.code -eq 0) -and ($r.out -match 'up to date') -and ((@(Get-TestAgentPids) -join ',') -eq ($pid0 -join ','))) ("code " + $r.code + " / " + $r.out)

    # --- TC2 no internet ------------------------------------------------------
    $r = Invoke-UpdaterAt "http://127.0.0.1:1/agent"
    Assert-That "TC2 server unreachable -> exit 5, v1.0.0 keeps running" (($r.code -eq 5) -and (Wait-Version "1.0.0" 3)) ("code " + $r.code + " / " + $r.out)

    # --- TC3 plain http to a real host is refused -----------------------------
    $r = Invoke-UpdaterAt "http://example.com/agent"
    Assert-That "TC3 non-https update URL -> refused (exit 6)" ($r.code -eq 6) ("code " + $r.code + " / " + $r.out)

    # --- TC4 Vercel answers a missing file with the dashboard's HTML ----------
    Get-ChildItem -LiteralPath $serverDir | Remove-Item -Force
    Set-Content -LiteralPath (Join-Path $serverDir "manifest.json") -Value "<!doctype html><html></html>"
    Set-Content -LiteralPath (Join-Path $serverDir "manifest.sig") -Value "<!doctype html><html></html>"
    $r = Invoke-UpdaterAt $base
    Assert-That "TC4 HTML instead of a manifest -> 'no release published' (exit 5), nothing changed" (($r.code -eq 5) -and ($r.out -match 'no release published') -and ((Get-FileHashHex (Join-Path $install "agent.ps1")) -eq $v1Hash)) ("code " + $r.code + " / " + $r.out)

    # --- TC4b a manifest that is valid JSON but carries no valid signature ----
    Set-Content -LiteralPath (Join-Path $serverDir "manifest.json") -Value '{ "version": "9.0.0", "files": { "agent.ps1": "00" } }'
    Set-Content -LiteralPath (Join-Path $serverDir "manifest.sig") -Value "bm90IGEgc2lnbmF0dXJl"
    $r = Invoke-UpdaterAt $base
    Assert-That "TC4b unsigned manifest -> rejected on signature (exit 3)" (($r.code -eq 3) -and ($r.out -match 'signature')) ("code " + $r.code + " / " + $r.out)

    # --- TC5 signed with someone else's key -----------------------------------
    Publish (New-AgentText "2.0.0" $null) (New-UpdaterText $attackerPub $null) $attackerKey
    $r = Invoke-UpdaterAt $base
    Assert-That "TC5 release signed with a different key -> rejected (exit 3), agent untouched and not restarted" (($r.code -eq 3) -and ($r.out -match 'signature') -and ((Get-FileHashHex (Join-Path $install "agent.ps1")) -eq $v1Hash) -and ((@(Get-TestAgentPids) -join ',') -eq ($pid0 -join ','))) ("code " + $r.code + " / " + $r.out)

    # --- TC6 correctly signed manifest, tampered agent.ps1 --------------------
    Publish (New-AgentText "2.0.0" $null) $v1Updater $releaseKey
    Add-Content -LiteralPath (Join-Path $serverDir "agent.ps1") -Value "Start-Process calc.exe"
    $r = Invoke-UpdaterAt $base
    Assert-That "TC6 file changed after signing -> rejected on SHA-256 (exit 3), nothing changed" (($r.code -eq 3) -and ($r.out -match 'SHA-256') -and ((Get-FileHashHex (Join-Path $install "agent.ps1")) -eq $v1Hash)) ("code " + $r.code + " / " + $r.out)

    # --- TC7 manifest tries to write outside the agent folder -----------------
    Publish-Raw @{ "agent.ps1" = (New-AgentText "2.0.0" $null); "..\evil.ps1" = "Start-Process calc.exe" } "2.0.0" $releaseKey
    $r = Invoke-UpdaterAt $base
    Assert-That "TC7 manifest listing an unexpected file/path -> rejected (exit 3)" (($r.code -eq 3) -and -not (Test-Path (Join-Path $T "evil.ps1"))) ("code " + $r.code + " / " + $r.out)

    # --- TC8 signed but does not parse ----------------------------------------
    Publish-Raw @{ "agent.ps1" = ((New-AgentText "2.0.0" $null) + "`r`nfunction Broken( {`r`n") } "2.0.0" $releaseKey
    $r = Invoke-UpdaterAt $base
    Assert-That "TC8 signed agent that does not parse -> rejected before any swap (exit 3)" (($r.code -eq 3) -and ($r.out -match 'parse') -and ((@(Get-TestAgentPids) -join ',') -eq ($pid0 -join ','))) ("code " + $r.code + " / " + $r.out)

    # --- TC9 manifest version != agent's own version --------------------------
    Publish-Raw @{ "agent.ps1" = (New-AgentText "1.9.0" $null) } "2.0.0" $releaseKey
    $r = Invoke-UpdaterAt $base
    Assert-That "TC9 manifest says v2.0.0 but agent.ps1 says v1.9.0 -> rejected (exit 3)" ($r.code -eq 3) ("code " + $r.code + " / " + $r.out)

    # --- TC10 new agent crashes on start -> automatic rollback ----------------
    Publish (New-AgentText "2.0.0" "exit 1") $v1Updater $releaseKey
    $r = Invoke-UpdaterAt $base
    $failedMark = Join-Path $install "update-failed.txt"
    Assert-That "TC10 new version never comes up -> rolled back (exit 4)" ($r.code -eq 4) ("code " + $r.code + " / " + $r.out)
    Assert-That "TC10 after rollback v1.0.0 is answering again" (Wait-Version "1.0.0" 10) ("status: " + ((Get-Status $AgentPort) | ConvertTo-Json -Compress))
    Assert-That "TC10 after rollback agent.ps1 is byte-identical to v1.0.0" ((Get-FileHashHex (Join-Path $install "agent.ps1")) -eq $v1Hash) "agent.ps1 differs"
    Assert-That "TC10 the bad version is remembered (update-failed.txt = 2.0.0)" ((Test-Path $failedMark) -and ((Get-Content -Raw $failedMark).Trim() -eq "2.0.0")) "marker missing/wrong"

    # --- TC11 the same bad version is not retried every check -----------------
    $pidR = @(Get-TestAgentPids)
    $r = Invoke-UpdaterAt $base
    Assert-That "TC11 known-bad v2.0.0 is skipped (exit 0, agent not restarted)" (($r.code -eq 0) -and ($r.out -match 'skipping') -and ((@(Get-TestAgentPids) -join ',') -eq ($pidR -join ','))) ("code " + $r.code + " / " + $r.out)

    # --- TC12 -CheckOnly verifies without installing --------------------------
    $v21Agent = New-AgentText "2.1.0" $null
    $v21Updater = New-UpdaterText $releasePub "test build 2.1.0"
    Publish $v21Agent $v21Updater $releaseKey
    $r = Invoke-Updater @("-AgentDir", $install, "-BaseUrl", $base, "-CheckOnly")
    Assert-That "TC12 -CheckOnly -> 'CHECK OK', nothing installed" (($r.code -eq 0) -and ($r.out -match 'CHECK OK') -and ((Get-FileHashHex (Join-Path $install "agent.ps1")) -eq $v1Hash)) ("code " + $r.code + " / " + $r.out)

    # --- TC13 two checks at once ----------------------------------------------
    $held = New-Object System.Threading.Mutex($false, "Local\QuickVerseAgentUpdater$AgentPort")
    [void]$held.WaitOne(0)
    $r = Invoke-UpdaterAt $base
    $held.ReleaseMutex(); $held.Dispose()
    Assert-That "TC13 a second updater while one runs -> exits 2, touches nothing" (($r.code -eq 2) -and ((Get-FileHashHex (Join-Path $install "agent.ps1")) -eq $v1Hash)) ("code " + $r.code + " / " + $r.out)

    # --- TC14 HAPPY PATH - exactly how the scheduled task runs it (no -AgentDir)
    $r = Invoke-Updater @("-BaseUrl", $base)
    Assert-That "TC14 signed newer release -> exit 0, 'UPDATED to v2.1.0'" (($r.code -eq 0) -and ($r.out -match 'UPDATED to v2\.1\.0')) ("code " + $r.code + " / " + $r.out)
    Assert-That "TC14 agent answers as v2.1.0" (Wait-Version "2.1.0" 5) ("status: " + ((Get-Status $AgentPort) | ConvertTo-Json -Compress))
    Assert-That "TC14 installed agent.ps1 is byte-identical to the published one" ((Get-FileHashHex (Join-Path $install "agent.ps1")) -eq (Get-FileHashHex (Join-Path $serverDir "agent.ps1"))) "hash differs"
    Assert-That "TC14 updater.ps1 replaced itself with the published one" ((Get-FileHashHex (Join-Path $install "updater.ps1")) -eq (Get-FileHashHex (Join-Path $serverDir "updater.ps1"))) "updater not replaced"
    Assert-That "TC14 previous\agent.ps1 kept for manual recovery" ((Test-Path (Join-Path $install "previous\agent.ps1")) -and ((Get-FileHashHex (Join-Path $install "previous\agent.ps1")) -eq $v1Hash)) "backup missing"
    Assert-That "TC14 update-failed.txt cleared, staging folder cleaned up" ((-not (Test-Path $failedMark)) -and (-not (Test-Path (Join-Path $install "update-staging")))) "leftovers present"
    $pr = $null
    try { Invoke-WebRequest -Uri "http://127.0.0.1:$AgentPort/print" -Method POST -Body '{"printer":"__qv_no_such_printer__","text":"x"}' -ContentType "application/json" -UseBasicParsing -TimeoutSec 20 | Out-Null } catch { if ($_.ErrorDetails) { $pr = $_.ErrorDetails.Message } }
    Assert-That "TC14 updated agent handles POST /print (answers 'Printer not found' for a bogus queue)" ($pr -match 'Printer not found') ("got: " + $pr)
    $log = Get-Content -Raw (Join-Path $install "update.log")
    Assert-That "TC14 update.log records the rollback and the update" (($log -match 'ROLLED BACK') -and ($log -match 'UPDATED to v2\.1\.0')) "log missing lines"

    # --- TC15 agent started by relative path (start-agent.vbs fallback) -------
    Stop-ScheduledTask -TaskName $taskName -ErrorAction SilentlyContinue
    foreach ($p in (Get-TestAgentPids)) { Stop-Process -Id $p -Force -ErrorAction SilentlyContinue }
    Start-Sleep -Seconds 1
    $rel = Start-Process powershell.exe -ArgumentList @("-NoProfile", "-ExecutionPolicy", "Bypass", "-File", "`"agent.ps1`"", "-Port", "$AgentPort") -WorkingDirectory $install -WindowStyle Hidden -PassThru
    [void](Wait-Version "2.1.0" 30)
    Publish (New-AgentText "2.2.0" $null) (New-UpdaterText $releasePub "test build 2.2.0") $releaseKey
    $r = Invoke-Updater @("-BaseUrl", $base)
    Assert-That "TC15 VBS-style (relative path) agent is stopped and updated -> v2.2.0" (($r.code -eq 0) -and (Wait-Version "2.2.0" 5) -and ($rel.HasExited)) ("code " + $r.code + " exited=" + $rel.HasExited + " / " + $r.out)

    # --- TC16 no scheduled task on this PC -> hidden fallback start -----------
    Unregister-ScheduledTask -TaskName $taskName -Confirm:$false
    Publish (New-AgentText "2.3.0" $null) (New-UpdaterText $releasePub "test build 2.3.0") $releaseKey
    $r = Invoke-Updater @("-BaseUrl", $base)
    Assert-That "TC16 agent task missing -> updater starts the agent itself, v2.3.0 healthy" (($r.code -eq 0) -and (Wait-Version "2.3.0" 5)) ("code " + $r.code + " / " + $r.out)

    # --- production agent was never touched -----------------------------------
    $prodAfter = Get-Status 1818
    Assert-That "SAFETY production agent on 1818 untouched" ((($null -eq $prodBefore) -and ($null -eq $prodAfter)) -or ($prodBefore.version -eq $prodAfter.version)) ("before " + ($prodBefore | ConvertTo-Json -Compress) + " after " + ($prodAfter | ConvertTo-Json -Compress))
    $prodTaskAfter = $null
    try { $prodTaskAfter = (Get-ScheduledTask -TaskName "QuickVerse Print Agent" -ErrorAction Stop).State } catch { }
    Assert-That "SAFETY production 'QuickVerse Print Agent' task untouched" ("$prodTaskBefore" -eq "$prodTaskAfter") ("before $prodTaskBefore after $prodTaskAfter")
} finally {
    try { Stop-ScheduledTask -TaskName $taskName -ErrorAction SilentlyContinue } catch { }
    try { Unregister-ScheduledTask -TaskName $taskName -Confirm:$false -ErrorAction SilentlyContinue } catch { }
    foreach ($p in (Get-TestAgentPids)) { Stop-Process -Id $p -Force -ErrorAction SilentlyContinue }
    if ($serverProc -and -not $serverProc.HasExited) { Stop-Process -Id $serverProc.Id -Force -ErrorAction SilentlyContinue }
    Start-Sleep -Milliseconds 500
    Remove-Item -LiteralPath $T -Recurse -Force -ErrorAction SilentlyContinue
}

Write-Output ""
if ($script:Failures -eq 0) { Write-Output "ALL TESTS PASSED" } else { Write-Output ("FAILED ASSERTIONS: " + $script:Failures) }
exit $script:Failures
