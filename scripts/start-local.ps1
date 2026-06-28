#Requires -Version 5.1

<#
.SYNOPSIS
    Start the EPM Notification Service locally for a real (non-mock) test.

.DESCRIPTION
    Ensures Azurite (storage emulator, required by the timer trigger) is running,
    frees port 7071 if a previous host is stuck, rebuilds the code, and starts
    the Functions host. Run this, then generate a real elevation request in EPM.
#>

$ErrorActionPreference = "Stop"
$root = Split-Path -Parent $PSScriptRoot
Set-Location $root

function Write-Step($m) { Write-Host "`n=== $m ===" -ForegroundColor Cyan }

# 1. Free port 7071 if a previous func host is still holding it
Write-Step "Checking port 7071"
$conn = Get-NetTCPConnection -LocalPort 7071 -State Listen -ErrorAction SilentlyContinue
if ($conn) {
    $conn | ForEach-Object { Stop-Process -Id $_.OwningProcess -Force -ErrorAction SilentlyContinue }
    Write-Host "Freed port 7071" -ForegroundColor Yellow
} else {
    Write-Host "Port 7071 is free" -ForegroundColor Green
}

# 2. Ensure Azurite is running (timer trigger needs AzureWebJobsStorage)
Write-Step "Checking Azurite (storage emulator)"
$azuriteUp = Test-NetConnection -ComputerName 127.0.0.1 -Port 10000 -InformationLevel Quiet -WarningAction SilentlyContinue
if (-not $azuriteUp) {
    if (-not (Get-Command azurite -ErrorAction SilentlyContinue)) {
        Write-Host "Azurite not installed. Installing globally..." -ForegroundColor Yellow
        npm install -g azurite | Out-Null
    }
    Write-Host "Starting Azurite in a background window..." -ForegroundColor Yellow
    New-Item -ItemType Directory -Force -Path "$root\.azurite" | Out-Null
    Start-Process azurite -ArgumentList "--silent","--location","$root\.azurite" -WindowStyle Minimized
    Start-Sleep -Seconds 3
    Write-Host "Azurite started" -ForegroundColor Green
} else {
    Write-Host "Azurite already running" -ForegroundColor Green
}

# 3. Rebuild
Write-Step "Building"
npm run build
Write-Host "Build OK" -ForegroundColor Green

# 4. Start the Functions host (foreground)
Write-Step "Starting Functions host (Ctrl+C to stop)"
func start
