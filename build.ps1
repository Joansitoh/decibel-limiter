# Builds a Chrome Web Store-ready zip from extension/.
# Minifies JS (mangle + compress) — allowed by CWS.
# Does NOT obfuscate: CWS forbids obfuscation / concealed functionality
# (https://developer.chrome.com/docs/webstore/program-policies/code-readability).
#
# Usage:
#   .\build.ps1
#   .\build.ps1 -SkipMinify   # zip sources as-is (debug / review)

param(
    [switch]$SkipMinify
)

$ErrorActionPreference = 'Stop'

$root = $PSScriptRoot
$extensionDir = Join-Path $root 'extension'
$manifestPath = Join-Path $extensionDir 'manifest.json'

if (-not (Test-Path $manifestPath)) {
    throw "Missing manifest: $manifestPath"
}

$manifest = Get-Content $manifestPath -Raw | ConvertFrom-Json
$version = $manifest.version

$outputDir = Join-Path $root 'dist'
New-Item -ItemType Directory -Force -Path $outputDir | Out-Null

$staging = Join-Path $outputDir "_staging"
if (Test-Path $staging) {
    Remove-Item $staging -Recurse -Force
}
Copy-Item -Path $extensionDir -Destination $staging -Recurse

function Assert-Node {
    $node = Get-Command node -ErrorAction SilentlyContinue
    if (-not $node) {
        throw "Node.js is required to minify. Install Node or pass -SkipMinify."
    }
}

function Minify-JsTree([string]$dir) {
    Assert-Node
    $files = Get-ChildItem -Path $dir -Recurse -Filter '*.js' |
        Where-Object { $_.Name -notlike '*.min.js' }

    if (-not $files) {
        Write-Host "No JS files to minify."
        return
    }

    Write-Host "Minifying $($files.Count) JS file(s) with esbuild..."
    foreach ($file in $files) {
        $rel = $file.FullName.Substring($dir.Length).TrimStart('\', '/')
        $inOut = $file.FullName
        & npx --yes esbuild@0.25.0 $inOut --minify --legal-comments=none "--outfile=$inOut" --allow-overwrite
        if ($LASTEXITCODE -ne 0) {
            throw "esbuild failed on $rel"
        }
        Write-Host "  minified $rel"
    }
}

if (-not $SkipMinify) {
    Minify-JsTree $staging
} else {
    Write-Host "Skipping minify (-SkipMinify)."
}

$zipPath = Join-Path $outputDir "decibel-limiter-$version.zip"
if (Test-Path $zipPath) {
    Remove-Item $zipPath -Force
}

Compress-Archive -Path (Join-Path $staging '*') -DestinationPath $zipPath
Remove-Item $staging -Recurse -Force

Write-Host "Built $zipPath"
if (-not $SkipMinify) {
    Write-Host "Note: output is minified (CWS-allowed), not obfuscated (CWS-forbidden)."
}
