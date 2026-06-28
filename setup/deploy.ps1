#Requires -Version 5.1
#Requires -Modules @{ ModuleName="Az.Accounts"; ModuleVersion="2.10.0" }, @{ ModuleName="Az.Functions"; ModuleVersion="4.0.0" }

<#
.SYNOPSIS
    Deploy the EPM Notification Service to Azure

.DESCRIPTION
    This script sets up all required Azure resources and deploys the EPM Notification Service.
    It will create an Entra app registration, Azure Function App, and configure all settings.

.EXAMPLE
    .\deploy.ps1
#>

param(
    [string]$EnvironmentName = "Production",
    [string]$Location = "eastus",
    [switch]$SkipAzureLogin
)

$ErrorActionPreference = "Stop"
$ProgressPreference = "SilentlyContinue"

# Colors for output
$Colors = @{
    Success = "Green"
    Error   = "Red"
    Warning = "Yellow"
    Info    = "Cyan"
}

function Write-Success {
    param([string]$Message)
    Write-Host "✓ $Message" -ForegroundColor $Colors.Success
}

function Write-Error-Custom {
    param([string]$Message)
    Write-Host "✗ $Message" -ForegroundColor $Colors.Error
}

function Write-Warning-Custom {
    param([string]$Message)
    Write-Host "⚠ $Message" -ForegroundColor $Colors.Warning
}

function Write-Info {
    param([string]$Message)
    Write-Host "ℹ $Message" -ForegroundColor $Colors.Info
}

function Pause-Script {
    param([string]$Message = "Press any key to continue...")
    Write-Host "`n$Message" -ForegroundColor Yellow
    $null = $Host.UI.RawUI.ReadKey("NoEcho,IncludeKeyDown")
}

# ============================================================================
# 1. PREFLIGHT CHECKS
# ============================================================================

Write-Info "EPM Notification Service - Azure Deployment"
Write-Info "============================================`n"

Write-Info "Checking prerequisites..."

# Each tool maps to a winget package so we can tell the user exactly how to
# install anything that's missing, rather than failing deep into the script.
$prereqs = @(
    @{ Cmd = "az";   Name = "Azure CLI";                  Winget = "Microsoft.AzureCLI" },
    @{ Cmd = "node"; Name = "Node.js LTS";                Winget = "OpenJS.NodeJS.LTS" },
    @{ Cmd = "npm";  Name = "npm (bundled with Node.js)"; Winget = "OpenJS.NodeJS.LTS" },
    @{ Cmd = "func"; Name = "Azure Functions Core Tools"; Winget = "Microsoft.Azure.FunctionsCoreTools" }
)

$missing = @()
foreach ($p in $prereqs) {
    if (Get-Command $p.Cmd -ErrorAction SilentlyContinue) {
        Write-Success "$($p.Name)"
    }
    else {
        Write-Error-Custom "$($p.Name) not found"
        $missing += $p
    }
}

if ($missing.Count -gt 0) {
    Write-Host "`nInstall the missing prerequisites, then re-run this installer:`n" -ForegroundColor Yellow
    foreach ($p in ($missing | Sort-Object -Property Winget -Unique)) {
        Write-Host "  winget install --id $($p.Winget) -e" -ForegroundColor White
    }
    Write-Host ""
    exit 1
}

# Check if already logged in
if (-not $SkipAzureLogin) {
    try {
        $context = az account show 2>$null | ConvertFrom-Json
        Write-Success "Already logged in as $($context.user.name)"
    }
    catch {
        Write-Info "Logging into Azure..."
        az login --use-device-code
        $context = az account show | ConvertFrom-Json
    }
}

$context = az account show | ConvertFrom-Json
$TenantId = $context.tenantId
$SubscriptionId = $context.id
$AccountName = $context.user.name

Write-Success "Using subscription: $($context.name) ($SubscriptionId)"

# ============================================================================
# 2. GATHER USER INPUT
# ============================================================================

Write-Info "`nConfiguration Required"
Write-Info "=====================`n"

# Shared Mailbox Email
do {
    $SharedMailboxEmail = Read-Host "Enter shared mailbox email (e.g., epm-approvals@contoso.com)"
    if ($SharedMailboxEmail -notmatch '^[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$') {
        Write-Warning-Custom "Invalid email format. Please try again."
        $SharedMailboxEmail = $null
    }
} while ([string]::IsNullOrWhiteSpace($SharedMailboxEmail))

Write-Success "Shared mailbox: $SharedMailboxEmail"

# Function App Name
$DefaultFunctionAppName = "epm-service-$(Get-Date -Format 'yyyyMMddHHmm')"
$FunctionAppName = Read-Host "Enter Function App name [default: $DefaultFunctionAppName]"
if ([string]::IsNullOrWhiteSpace($FunctionAppName)) {
    $FunctionAppName = $DefaultFunctionAppName
}

Write-Success "Function App name: $FunctionAppName"

# Resource Group
$DefaultRgName = "rg-epm-notification"
$ResourceGroupName = Read-Host "Enter Resource Group name [default: $DefaultRgName]"
if ([string]::IsNullOrWhiteSpace($ResourceGroupName)) {
    $ResourceGroupName = $DefaultRgName
}

Write-Success "Resource Group: $ResourceGroupName"

# ============================================================================
# 3. CREATE ENTRA APP REGISTRATION
# ============================================================================

Write-Info "`nCreating Entra App Registration..."

$AppDisplayName = "EPM Notification Service"

# Check if app already exists
$ExistingApp = az ad app list --filter "displayName eq '$AppDisplayName'" --query "[0]" 2>$null | ConvertFrom-Json
if ($ExistingApp -and $ExistingApp.appId) {
    Write-Warning-Custom "App registration '$AppDisplayName' already exists"
    $AppId = $ExistingApp.appId
    $AppObjectId = $ExistingApp.id
}
else {
    # Create new app registration
    $AppJson = az ad app create `
        --display-name $AppDisplayName `
        --query "{appId: appId, id: id}" 2>$null | ConvertFrom-Json

    $AppId = $AppJson.appId
    $AppObjectId = $AppJson.id
    Write-Success "Entra app created: $AppId"
}

# Create service principal if doesn't exist
$ExistingSP = az ad sp list --filter "appId eq '$AppId'" --query "[0]" 2>$null | ConvertFrom-Json
if (-not $ExistingSP.id) {
    $SPJson = az ad sp create --id $AppId --query "id" 2>$null
    $ServicePrincipalId = $SPJson | ConvertFrom-Json
    Write-Success "Service principal created: $ServicePrincipalId"
}
else {
    $ServicePrincipalId = $ExistingSP.id
    Write-Success "Service principal exists: $ServicePrincipalId"
}

# Create client secret
Write-Info "Creating client secret..."
$SecretJson = az ad app credential reset `
    --id $AppId `
    --credential-description "EPM Service Secret" `
    --years 1 `
    --query "{password: password, startDate: startDate}" 2>$null | ConvertFrom-Json

$ClientSecret = $SecretJson.password
Write-Success "Client secret created (expires in 1 year)"
Write-Warning-Custom "IMPORTANT: Save this secret securely - it will not be shown again:"
Write-Host "`n  $ClientSecret`n" -ForegroundColor Yellow

Read-Host "Press Enter to continue after saving the secret"

# Grant API permissions (application/app-only roles, since we use client credentials)
Write-Info "Granting API permissions..."

# Mail.Send (Application role) - send notification emails via the shared mailbox
az ad app permission add --id $AppId --api 00000003-0000-0000-c000-000000000000 --api-permissions b633e1c5-b582-4048-a93e-9f11b44c7e96=Role 2>$null
Write-Success "Mail.Send permission added"

# DeviceManagementConfiguration.ReadWrite.All (Application role) -
# read EPM elevation requests and approve/deny them
az ad app permission add --id $AppId --api 00000003-0000-0000-c000-000000000000 --api-permissions 9241abd9-d0e6-425a-bd4f-47ba86e767a4=Role 2>$null
Write-Success "DeviceManagementConfiguration.ReadWrite.All permission added"

# Grant admin consent
Write-Info "Granting admin consent for permissions..."
az ad app permission admin-consent --id $AppId 2>$null
Write-Success "Admin consent granted"

# ============================================================================
# 4. CREATE AZURE RESOURCES
# ============================================================================

Write-Info "`nCreating Azure resources..."

# Create Resource Group
$RgExists = az group exists --name $ResourceGroupName
if ($RgExists -eq "false") {
    Write-Info "Creating resource group: $ResourceGroupName"
    az group create --name $ResourceGroupName --location $Location | Out-Null
    Write-Success "Resource group created"
}
else {
    Write-Success "Resource group exists: $ResourceGroupName"
}

# Create Storage Account (required for Function App)
$StorageAccountName = "st$(-join ((97..122) | Get-Random -Count 8 | % {[char]$_}))"
Write-Info "Creating storage account: $StorageAccountName"
az storage account create `
    --name $StorageAccountName `
    --resource-group $ResourceGroupName `
    --location $Location `
    --sku Standard_LRS 2>$null | Out-Null
Write-Success "Storage account created"

# Create Function App (Consumption plan)
Write-Info "Creating Function App: $FunctionAppName"
az functionapp create `
    --name $FunctionAppName `
    --resource-group $ResourceGroupName `
    --runtime node `
    --runtime-version 20 `
    --functions-version 4 `
    --storage-account $StorageAccountName `
    --os-type Windows 2>$null | Out-Null
Write-Success "Function App created"

# The public base URL of the Function App. This is how approvers' email
# buttons reach the approval webhook, so it must be the deployed URL.
$FunctionBaseUrl = "https://$FunctionAppName.azurewebsites.net"
$WebhookUrl = "$FunctionBaseUrl/api/approve"

# ============================================================================
# 5. RESOLVE SHARED MAILBOX OBJECT ID
# ============================================================================

Write-Info "`nResolving shared mailbox object ID..."
$SharedMailboxId = az ad user show --id $SharedMailboxEmail --query id -o tsv 2>$null
if ([string]::IsNullOrWhiteSpace($SharedMailboxId)) {
    Write-Warning-Custom "Could not auto-resolve the object ID for $SharedMailboxEmail."
    $SharedMailboxId = Read-Host "Enter the shared mailbox Object ID manually"
}
else {
    Write-Success "Shared mailbox object ID: $SharedMailboxId"
}

# ============================================================================
# 6. CONFIGURE APPLICATION SETTINGS
# ============================================================================

Write-Info "`nConfiguring Function App settings..."

$AppSettings = @(
    "TENANT_ID=$TenantId",
    "CLIENT_ID=$AppId",
    "CLIENT_SECRET=$ClientSecret",
    "SHARED_MAILBOX_EMAIL=$SharedMailboxEmail",
    "SHARED_MAILBOX_ID=$SharedMailboxId",
    "WEBHOOK_URL=$WebhookUrl",
    "POLL_INTERVAL_MINUTES=5",
    "TOKEN_EXPIRY_MINUTES=1440",
    "LOG_LEVEL=info",
    "MOCK_MODE=false"
)

az functionapp config appsettings set `
    --name $FunctionAppName `
    --resource-group $ResourceGroupName `
    --settings $AppSettings | Out-Null

Write-Success "Application settings configured"

# ============================================================================
# 7. BUILD AND PUBLISH THE CODE
# ============================================================================

Write-Info "`nBuilding and publishing the function code..."

# The script runs from <install dir>\setup, so the project root is one level up.
$ProjectRoot = Split-Path -Parent $PSScriptRoot
Push-Location $ProjectRoot
try {
    Write-Info "Installing dependencies..."
    npm install | Out-Null

    Write-Info "Building TypeScript..."
    npm run build | Out-Null

    Write-Info "Publishing to Azure (this can take a few minutes)..."
    func azure functionapp publish $FunctionAppName
    Write-Success "Code published"
}
finally {
    Pop-Location
}

# ============================================================================
# 8. DONE
# ============================================================================

Write-Host "`n$("="*70)" -ForegroundColor Cyan
Write-Success "Deployment Complete!"
Write-Host "$("="*70)`n" -ForegroundColor Cyan

Write-Host "Summary:" -ForegroundColor Cyan
Write-Host "  Function App:     $FunctionAppName"
Write-Host "  Webhook URL:      $WebhookUrl"
Write-Host "  Resource Group:   $ResourceGroupName"
Write-Host "  App ID:           $AppId"
Write-Host "  Tenant ID:        $TenantId"
Write-Host "  Shared Mailbox:   $SharedMailboxEmail ($SharedMailboxId)`n"

Write-Host "The service is now polling EPM every 5 minutes. When an elevation" -ForegroundColor Cyan
Write-Host "request arrives, an email with Approve/Deny buttons is sent to the" -ForegroundColor Cyan
Write-Host "shared mailbox. Clicking a button actions the request in Intune.`n" -ForegroundColor Cyan

Write-Warning-Custom "Your Client Secret was stored as a Function App setting. Rotate it if it was exposed."
Write-Host "`nFor more information, see README.md`n"

Pause-Script
