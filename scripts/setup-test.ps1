#Requires -Version 5.1

<#
.SYNOPSIS
    Quick setup for local testing

.DESCRIPTION
    This script helps you set up the local testing environment with minimal steps
#>

param(
    [switch]$SkipDependencies
)

$ErrorActionPreference = "Stop"

Write-Host "EPM Notification Service - Local Testing Setup" -ForegroundColor Cyan
Write-Host "=" * 50 `n

# ============================================================================
# 1. CHECK PREREQUISITES
# ============================================================================

Write-Host "Checking prerequisites..." -ForegroundColor Yellow

$checks = @{
    "Node.js" = { node --version }
    "npm" = { npm --version }
    "Azure CLI" = { az --version }
    "Azure Functions Core Tools" = { func --version }
}

foreach ($check in $checks.GetEnumerator()) {
    try {
        & $check.Value | Out-Null
        Write-Host "✓ $($check.Name)" -ForegroundColor Green
    }
    catch {
        Write-Host "✗ $($check.Name) - Please install" -ForegroundColor Red
        exit 1
    }
}

# ============================================================================
# 2. INSTALL DEPENDENCIES
# ============================================================================

if (-not $SkipDependencies) {
    Write-Host "`nInstalling npm dependencies..." -ForegroundColor Yellow
    npm install
    if ($LASTEXITCODE -ne 0) {
        Write-Host "Failed to install dependencies" -ForegroundColor Red
        exit 1
    }
    Write-Host "✓ Dependencies installed" -ForegroundColor Green
}

# ============================================================================
# 3. BUILD TYPESCRIPT
# ============================================================================

Write-Host "`nBuilding TypeScript..." -ForegroundColor Yellow
npm run build
if ($LASTEXITCODE -ne 0) {
    Write-Host "Failed to build" -ForegroundColor Red
    exit 1
}
Write-Host "✓ Build successful" -ForegroundColor Green

# ============================================================================
# 4. CHECK .ENV FILE
# ============================================================================

Write-Host "`nChecking environment configuration..." -ForegroundColor Yellow

if (-not (Test-Path ".env")) {
    Write-Host "Creating .env from template..." -ForegroundColor Yellow
    Copy-Item ".env.example" ".env"
    Write-Host "✓ .env file created (you need to edit it)" -ForegroundColor Green

    Write-Host "`nIMPORTANT: Edit .env with your Azure credentials:" -ForegroundColor Yellow
    Write-Host "  TENANT_ID=your-tenant-id"
    Write-Host "  CLIENT_ID=your-app-id"
    Write-Host "  CLIENT_SECRET=your-app-secret"
    Write-Host "  SHARED_MAILBOX_EMAIL=epm-approvals@yourtenant.onmicrosoft.com"
    Write-Host "  SHARED_MAILBOX_ID=mailbox-object-id"
    Write-Host ""

    # Open .env in default editor
    Invoke-Item ".env"

    Write-Host "Press Enter when you've updated .env..." -ForegroundColor Cyan
    Read-Host
}
else {
    Write-Host "✓ .env file found" -ForegroundColor Green
}

# ============================================================================
# 5. VALIDATE .ENV
# ============================================================================

Write-Host "`nValidating environment variables..." -ForegroundColor Yellow

$envContent = Get-Content ".env"
$required = @("TENANT_ID", "CLIENT_ID", "CLIENT_SECRET", "SHARED_MAILBOX_EMAIL")

foreach ($var in $required) {
    if ($envContent -match "^$var=") {
        Write-Host "✓ $var configured" -ForegroundColor Green
    }
    else {
        Write-Host "✗ $var missing - please update .env" -ForegroundColor Red
        exit 1
    }
}

# ============================================================================
# 6. READY FOR TESTING
# ============================================================================

Write-Host "`nSetup complete! Ready to test locally." -ForegroundColor Green
Write-Host "`nNext steps:" -ForegroundColor Cyan
Write-Host "  1. Run: func start"
Write-Host "  2. In another terminal, test: curl -X POST http://localhost:7071/admin/functions/pollElevationRequests"
Write-Host "  3. Follow testing guide in TESTING.md"
Write-Host "`nDocumentation:" -ForegroundColor Cyan
Write-Host "  - TESTING.md  - Complete testing guide"
Write-Host "  - README.md   - Project overview"
Write-Host ""
