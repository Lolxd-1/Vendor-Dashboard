# Publish a print-agent release for every shop's auto-updater.
#
#   1. Bump $AGENT_VERSION in print-agent/agent.ps1 (the updater only installs
#      a version NEWER than what a shop runs).
#   2. Run:  powershell -ExecutionPolicy Bypass -File tools\agent-release\Publish-AgentRelease.ps1
#   3. Commit public/agent/ and push -> Vercel serves it -> shops pick it up
#      at their next morning / night check.
#
# Writes public/agent/{agent.ps1, updater.ps1, manifest.json, manifest.sig}.
# manifest.json = version + SHA-256 of each file; manifest.sig = RSA-SHA256
# signature of manifest.json's exact bytes, made with the private key.
param(
    [string] $AgentPath = (Join-Path $PSScriptRoot "..\..\print-agent\agent.ps1"),
    [string] $UpdaterPath = (Join-Path $PSScriptRoot "..\..\print-agent\updater.ps1"),
    [string] $OutDir = (Join-Path $PSScriptRoot "..\..\public\agent"),
    [string] $KeyPath = (Join-Path $env:USERPROFILE ".quickverse\agent-signing-key.xml")
)
$ErrorActionPreference = 'Stop'

function Get-Sha256Hex([byte[]] $bytes) {
    $sha = [System.Security.Cryptography.SHA256]::Create()
    try { return (($sha.ComputeHash($bytes) | ForEach-Object { $_.ToString('x2') }) -join '') } finally { $sha.Dispose() }
}

if (-not (Test-Path -LiteralPath $KeyPath)) { throw "No signing key at $KeyPath (run New-AgentSigningKey.ps1 once, or restore your backup)." }
$rsa = New-Object System.Security.Cryptography.RSACryptoServiceProvider
$rsa.FromXmlString([System.IO.File]::ReadAllText($KeyPath))
$public = $rsa.ToXmlString($false)

$agentBytes = [System.IO.File]::ReadAllBytes((Resolve-Path $AgentPath))
$updaterBytes = [System.IO.File]::ReadAllBytes((Resolve-Path $UpdaterPath))
$agentText = [System.Text.Encoding]::UTF8.GetString($agentBytes)
$updaterText = [System.Text.Encoding]::UTF8.GetString($updaterBytes)

$m = [regex]::Match($agentText, '(?m)^\$AGENT_VERSION = "([0-9]+(\.[0-9]+){1,3})"')
if (-not $m.Success) { throw "`$AGENT_VERSION not found in $AgentPath" }
$version = $m.Groups[1].Value

# The updater being shipped must trust THIS key, or every shop that installs it
# can never verify another release.
$k = [regex]::Match($updaterText, "(?m)^\`$PUBLIC_KEY_XML = '([^'\r\n]*)'")
if (-not $k.Success -or $k.Groups[1].Value -ne $public) {
    throw "updater.ps1's `$PUBLIC_KEY_XML does not match the key at $KeyPath - refusing to publish an updater that could not verify later releases."
}
foreach ($p in @($AgentPath, $UpdaterPath)) {
    $t = $null; $e = $null
    [void][System.Management.Automation.Language.Parser]::ParseFile((Resolve-Path $p), [ref]$t, [ref]$e)
    if (@($e).Count -gt 0) { throw "$p does not parse: $($e[0].Message)" }
}

New-Item -ItemType Directory -Path $OutDir -Force | Out-Null
$OutDir = (Resolve-Path $OutDir).Path
[System.IO.File]::WriteAllBytes((Join-Path $OutDir 'agent.ps1'), $agentBytes)
[System.IO.File]::WriteAllBytes((Join-Path $OutDir 'updater.ps1'), $updaterBytes)

$manifest = "{`n  `"version`": `"$version`",`n  `"files`": {`n    `"agent.ps1`": `"$(Get-Sha256Hex $agentBytes)`",`n    `"updater.ps1`": `"$(Get-Sha256Hex $updaterBytes)`"`n  }`n}`n"
$manifestBytes = (New-Object System.Text.UTF8Encoding($false)).GetBytes($manifest)
$sig = $rsa.SignData($manifestBytes, [System.Security.Cryptography.CryptoConfig]::MapNameToOID('SHA256'))
[System.IO.File]::WriteAllBytes((Join-Path $OutDir 'manifest.json'), $manifestBytes)
[System.IO.File]::WriteAllText((Join-Path $OutDir 'manifest.sig'), [Convert]::ToBase64String($sig), [System.Text.Encoding]::ASCII)

# Self-check with the public half, exactly as a shop will.
$verify = New-Object System.Security.Cryptography.RSACryptoServiceProvider
$verify.FromXmlString($public)
if (-not $verify.VerifyData([System.IO.File]::ReadAllBytes((Join-Path $OutDir 'manifest.json')), [System.Security.Cryptography.CryptoConfig]::MapNameToOID('SHA256'), [Convert]::FromBase64String([System.IO.File]::ReadAllText((Join-Path $OutDir 'manifest.sig'))))) {
    throw "self-check failed: the signature just written does not verify"
}

Write-Output "Published agent v$version to $OutDir (signed, self-check OK)."
Write-Output "Next: commit public/agent and push - shops update at their next morning/night check."
