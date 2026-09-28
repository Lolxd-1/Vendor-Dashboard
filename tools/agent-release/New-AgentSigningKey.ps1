# ONE-TIME: create the QuickVerse release signing key.
#
#   Private key -> $KeyPath (default: %USERPROFILE%\.quickverse\agent-signing-key.xml)
#                  Stays on this PC. Never commit it, never upload it.
#                  BACK IT UP (USB / password manager): without it no update
#                  can ever be signed again, and every shop needs a manual reinstall.
#   Public key  -> written into print-agent/updater.ps1 ($PUBLIC_KEY_XML).
#
# Refuses to overwrite an existing key: a new key would lock every installed
# updater out of future releases.
param(
    [string] $KeyPath = (Join-Path $env:USERPROFILE ".quickverse\agent-signing-key.xml"),
    [string] $UpdaterPath = (Join-Path $PSScriptRoot "..\..\print-agent\updater.ps1")
)
$ErrorActionPreference = 'Stop'

if (Test-Path -LiteralPath $KeyPath) {
    Write-Output "A signing key already exists at $KeyPath - not overwriting it."
    exit 1
}

$rsa = New-Object System.Security.Cryptography.RSACryptoServiceProvider(3072)
try {
    $private = $rsa.ToXmlString($true)
    $public = $rsa.ToXmlString($false)
} finally { $rsa.Dispose() }

New-Item -ItemType Directory -Path (Split-Path -Parent $KeyPath) -Force | Out-Null
[System.IO.File]::WriteAllText($KeyPath, $private, (New-Object System.Text.UTF8Encoding($false)))

$src = [System.IO.File]::ReadAllText($UpdaterPath)
$pattern = "(?m)^\`$PUBLIC_KEY_XML = '[^'\r\n]*'(?=\r?$)"
if (-not [regex]::IsMatch($src, $pattern)) { throw "`$PUBLIC_KEY_XML line not found in $UpdaterPath" }
$line = "`$PUBLIC_KEY_XML = '$public'"
$src = [regex]::Replace($src, $pattern, { param($m) $line })
[System.IO.File]::WriteAllText($UpdaterPath, $src, (New-Object System.Text.UTF8Encoding($false)))

Write-Output "Private key : $KeyPath   <- BACK THIS UP. Never commit it."
Write-Output "Public key  : written into $UpdaterPath"
