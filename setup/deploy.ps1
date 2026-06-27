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

# Check Azure CLI
if (-not (Get-Command az -ErrorAction SilentlyContinue)) {
    Write-Error-Custom "Azure CLI not found. Please install from https://aka.ms/azure-cli"
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

# Grant API permissions
Write-Info "Granting API permissions..."

# Mail.Send
az ad app permission add --id $AppId --api 00000003-0000-0000-c000-000000000000 --api-permissions e1fe6dd8-ba31-4d61-89e7-88639da4683d=Scope 2>$null
Write-Success "Mail.Send permission added"

# Device.Read.All
az ad app permission add --id $AppId --api 00000003-0000-0000-c000-000000000000 --api-permissions 7438b122-aeadda18-3842-4cb9-3f49-b6b2359caf16=Scope 2>$null
Write-Success "Device.Read.All permission added"

# User.Read.All
az ad app permission add --id $AppId --api 00000003-0000-0000-c000-000000000000 --api-permissions a154be20-db80-4a3d-a555-7b6a3d20e882=Scope 2>$null
Write-Success "User.Read.All permission added"

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

# Create Key Vault
$KeyVaultName = "kv-epm-$(Get-Date -Format 'yyyyMMdd')"
Write-Info "Creating Key Vault: $KeyVaultName"
az keyvault create `
    --name $KeyVaultName `
    --resource-group $ResourceGroupName `
    --location $Location 2>$null | Out-Null
Write-Success "Key Vault created"

# ============================================================================
# 5. CONFIGURE APPLICATION SETTINGS
# ============================================================================

Write-Info "`nConfiguring Function App settings..."

$AppSettings = @(
    "TENANT_ID=$TenantId",
    "CLIENT_ID=$AppId",
    "CLIENT_SECRET=$ClientSecret",
    "SHARED_MAILBOX_EMAIL=$SharedMailboxEmail",
    "POLL_INTERVAL_MINUTES=5",
    "TOKEN_EXPIRY_MINUTES=1440",
    "LOG_LEVEL=info"
)

az functionapp config appsettings set `
    --name $FunctionAppName `
    --resource-group $ResourceGroupName `
    --settings $AppSettings | Out-Null

Write-Success "Application settings configured"

# ============================================================================
# 6. DEPLOYMENT INSTRUCTIONS
# ============================================================================

Write-Info "`n" + ("="*70)
Write-Success "Deployment Setup Complete!"
Write-Info ("="*70)

Write-Host "`nNext Steps:`n" -ForegroundColor Cyan
Write-Host "1. Find your shared mailbox Object ID in Azure AD:"
Write-Host "   - Go to Azure Portal > Azure AD > Users or Groups"
Write-Host "   - Search for '$SharedMailboxEmail'"
Write-Host "   - Copy the Object ID`n"

Write-Host "2. Update the mailbox Object ID in Function App settings:"
Write-Host "   az functionapp config appsettings set ``"
Write-Host "     --name $FunctionAppName ``"
Write-Host "     --resource-group $ResourceGroupName ``"
Write-Host "     --settings SHARED_MAILBOX_ID=<object-id>`n"

Write-Host "3. Deploy the code to Azure:"
Write-Host "   npm install"
Write-Host "   func azure functionapp publish $FunctionAppName`n"

Write-Host "Summary:"
Write-Host "  Function App:     $FunctionAppName"
Write-Host "  Resource Group:   $ResourceGroupName"
Write-Host "  Key Vault:        $KeyVaultName"
Write-Host "  App ID:           $AppId"
Write-Host "  Tenant ID:        $TenantId"
Write-Host "  Shared Mailbox:   $SharedMailboxEmail`n"

Write-Warning-Custom "Keep your Client Secret secure. It has been set as an environment variable."
Write-Host "`nFor more information, see README.md`n"

Pause-Script
