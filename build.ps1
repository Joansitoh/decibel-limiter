# Zips extension/ into a Chrome Web Store-ready package, named with the
# version from extension/manifest.json (e.g. decibel-limiter-1.3.9.zip).

$ErrorActionPreference = 'Stop'

$root = $PSScriptRoot
$extensionDir = Join-Path $root 'extension'
$manifestPath = Join-Path $extensionDir 'manifest.json'

$manifest = Get-Content $manifestPath -Raw | ConvertFrom-Json
$version = $manifest.version

$outputDir = Join-Path $root 'dist'
New-Item -ItemType Directory -Force -Path $outputDir | Out-Null

$zipPath = Join-Path $outputDir "decibel-limiter-$version.zip"
if (Test-Path $zipPath) {
    Remove-Item $zipPath -Force
}

Compress-Archive -Path (Join-Path $extensionDir '*') -DestinationPath $zipPath

Write-Host "Built $zipPath"
