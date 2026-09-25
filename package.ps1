# Builds the Chrome Web Store upload: dist/screencapture-<version>.zip
# containing only the files the extension needs (no test page, store assets or docs).
# Usage: powershell -ExecutionPolicy Bypass -File .\package.ps1

$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.IO.Compression
Add-Type -AssemblyName System.IO.Compression.FileSystem

$root = $PSScriptRoot
$manifest = Get-Content (Join-Path $root 'manifest.json') -Raw | ConvertFrom-Json
$version = $manifest.version

$files = @(
  'manifest.json',
  'background.js',
  'content.js',
  'db.js',
  'settings.js',
  'popup.html', 'popup.js',
  'options.html', 'options.js',
  'preview.html', 'preview.js',
  'icons/icon16.png', 'icons/icon32.png', 'icons/icon48.png', 'icons/icon128.png'
)

$dist = Join-Path $root 'dist'
New-Item -ItemType Directory -Force $dist | Out-Null
$zipPath = Join-Path $dist "screencapture-$version.zip"
if (Test-Path $zipPath) { Remove-Item $zipPath }

# Written entry by entry so paths use forward slashes (Compress-Archive in
# Windows PowerShell writes backslashes, which the Web Store rejects).
$zip = [System.IO.Compression.ZipFile]::Open($zipPath, 'Create')
try {
  foreach ($file in $files) {
    $source = Join-Path $root $file
    if (-not (Test-Path $source)) { throw "Missing file: $file" }
    [System.IO.Compression.ZipFileExtensions]::CreateEntryFromFile($zip, $source, $file, 'Optimal') | Out-Null
  }
} finally {
  $zip.Dispose()
}

Write-Host "Created $zipPath ($($files.Count) files, version $version)"
