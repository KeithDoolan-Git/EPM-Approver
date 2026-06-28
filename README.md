# EPM Notification Service

A lightweight, portable Windows service that monitors Microsoft Intune Endpoint Privilege Management (EPM) elevation requests and sends email notifications with one-click approval/denial buttons.

## Features

✅ **Email Notifications** — Automatically notifies approvers when elevation requests arrive  
✅ **One-Click Approvals** — Approve or deny requests directly from email  
✅ **No Dashboard** — Minimal infrastructure, just notifications  
✅ **OOTB Deployment** — Download EXE, run setup, done  
✅ **Azure Functions** — Serverless, scalable, cost-effective  
✅ **Shared Mailbox Support** — Route notifications to your team's shared mailbox  

## System Requirements

- **Windows 10/11** (for running the installer)
- **Azure Subscription** (for Azure Functions, Storage, Key Vault)
- **Global Admin** or **Entra Application Administrator** role (for Entra setup)
- **Intune EPM License** on your tenant

## Quick Start (5 minutes)

### 1. Download the Installer

Download the latest `epm-setup.exe` from [GitHub Releases](https://github.com/KeithDoolan-Git/EPM-Approver/releases)

### 2. Run the Installer

```powershell
.\epm-setup.exe
```

The installer will:
- Extract the service files
- Open PowerShell to configure Azure resources
- Ask for your shared mailbox email
- Create the Entra app registration
- Deploy to Azure Functions
- Done!

### 3. Provide Shared Mailbox Object ID

After setup completes, find your shared mailbox's Object ID in Azure AD:

1. Go to **Azure Portal** → **Azure AD** → **Users or Groups**
2. Search for your shared mailbox email
3. Copy the **Object ID**
4. Run this command:

```powershell
az functionapp config appsettings set `
  --name <function-app-name> `
  --resource-group rg-epm-notification `
  --settings SHARED_MAILBOX_ID=<object-id>
```

## Manual Setup (Alternative)

If you prefer not to use the installer:

### Prerequisites

```powershell
# Install Azure CLI
choco install azure-cli -y

# Install Node.js 20+
choco install nodejs --version=20.0.0 -y

# Install Azure Functions Core Tools
choco install azure-functions-core-tools-4 -y
```

### Step 1: Clone the Repository

```bash
git clone https://github.com/KeithDoolan-Git/EPM-Approver.git
cd EPM-Approver
npm install
```

### Step 2: Run Setup Script

```powershell
.\setup\deploy.ps1
```

The script will prompt you for:
- Shared mailbox email
- Resource group name
- Function App name

### Step 3: Deploy Code

```bash
npm install -g azure-functions-core-tools@4
func azure functionapp publish <function-app-name>
```

## Configuration

After deployment, the Function App has these settings (set automatically by the setup script):

| Setting | Value |
|---------|-------|
| `TENANT_ID` | Your Azure AD tenant ID |
| `CLIENT_ID` | Entra app registration ID |
| `CLIENT_SECRET` | App registration secret (in Key Vault) |
| `SHARED_MAILBOX_EMAIL` | Your shared mailbox email |
| `SHARED_MAILBOX_ID` | Mailbox Object ID (set after deployment) |
| `POLL_INTERVAL_MINUTES` | 5 (check every 5 minutes) |
| `TOKEN_EXPIRY_MINUTES` | 1440 (24 hours) |
| `WEBHOOK_URL` | Your Function App's approval endpoint |

## How It Works

### 1. Polling (Every 5 Minutes)

The `poll-elevation-requests` function:
- Queries Intune EPM for pending requests
- Checks if the request was already notified
- Generates approval/denial tokens
- Sends email to your shared mailbox

### 2. Approval/Denial (Click Email Button)

When an approver clicks [APPROVE] or [DENY] in the email:
- Token is validated (signed JWT, checks expiry)
- Request is approved/denied in Intune via Graph API
- Confirmation email is sent to the requester
- Status is updated in the state tracker

### 3. Email Details

Each notification email includes:
- **Requester** name and email
- **Device** name
- **Application/File** being requested
- **Justification** provided by requester
- **Time remaining** to approve
- **[APPROVE]** and **[DENY]** buttons

## Architecture

```
┌─────────────────────────────────────────────────────────┐
│ Intune EPM (elevation requests)                         │
└────────────────────────┬────────────────────────────────┘
                         │
                         ▼
        ┌────────────────────────────────────┐
        │ Poll Function (every 5 minutes)    │
        │ - Read pending requests            │
        │ - Track which sent notifications   │
        │ - Generate approval tokens         │
        └────────────────┬───────────────────┘
                         │
                         ▼
    ┌────────────────────────────────────────────┐
    │ Send Email via Shared Mailbox (Graph API) │
    │ - To: epm-approvals@company.com           │
    │ - Include [APPROVE] and [DENY] buttons    │
    │ - Buttons link to approval webhook        │
    └────────────────┬───────────────────────────┘
                     │
                     ▼
        (Approver receives email in Outlook)
                     │
        ┌────────────┴──────────────┐
        ▼                           ▼
    [APPROVE]                   [DENY]
        │                           │
        └───────────┬───────────────┘
                    ▼
    ┌──────────────────────────────────────┐
    │ Approval Webhook Handler (HTTP)      │
    │ - Validate approval token            │
    │ - Call Intune EPM API                │
    │ - Send confirmation to requester     │
    └──────────────────────────────────────┘
                    │
                    ▼
    ┌──────────────────────────────────────┐
    │ Intune EPM (request status updated)  │
    │ Status: Approved/Denied              │
    └──────────────────────────────────────┘
```

## Security

- **JWT Tokens**: Signed with HS256, expire after 24 hours
- **No Database**: Minimal state tracking (JSON file)
- **Graph API**: Service principal authentication (OAuth 2.0)
- **Shared Mailbox**: Uses Graph API with delegated permissions
- **HTTPS Only**: All email links use secure HTTPS

## Troubleshooting

### Emails Not Arriving

1. Check Function App is running:
   ```powershell
   az functionapp show --name <app-name> --resource-group rg-epm-notification
   ```

2. Check Application Insights logs:
   - Azure Portal → Function App → Application Insights

3. Verify shared mailbox email:
   ```powershell
   az ad user show --id <shared-mailbox-email> --query id
   ```

### Approval Links Not Working

1. Verify webhook URL in settings:
   ```powershell
   az functionapp config appsettings list --name <app-name> --resource-group rg-epm-notification
   ```

2. Check token expiry (should be 1440 minutes = 24 hours)

3. Test approval endpoint manually:
   ```powershell
   curl "https://<function-app>.azurewebsites.net/api/approve?action=approve&token=<test-token>"
   ```

### Permissions Errors

1. Verify service principal has EPM permissions:
   ```powershell
   az ad app permission list --id <client-id>
   ```

2. Grant admin consent:
   ```powershell
   az ad app permission admin-consent --id <client-id>
   ```

## Development

### Local Testing

```bash
# Install dependencies
npm install

# Set environment variables
$env:TENANT_ID = "your-tenant-id"
$env:CLIENT_ID = "your-app-id"
$env:CLIENT_SECRET = "your-app-secret"
$env:SHARED_MAILBOX_EMAIL = "epm-approvals@company.com"
$env:WEBHOOK_URL = "http://localhost:7071/api/approve"

# Run locally
func start
```

The polling function will run every 5 minutes (configurable in `function.json`).

### Build & Deploy

```bash
# Build TypeScript
npm run build

# Deploy to Azure
func azure functionapp publish <function-app-name>
```

## API Reference

### Poll Elevation Requests

**Trigger**: Timer (every 5 minutes)

**Flow**:
1. Queries `/deviceManagement/elevation/elevationRequests`
2. For each pending request, sends email to shared mailbox
3. Tracks which requests were notified (state file)

### Process Approval

**Endpoint**: `GET/POST /api/approve`

**Parameters**:
- `action` (required): `approve` or `deny`
- `token` (required): Signed JWT approval token

**Response**: HTML confirmation page

**Errors**:
- `400`: Missing or invalid parameters
- `401`: Invalid or expired token
- `404`: Request not found
- `500`: Intune API error

## Contributing

Contributions welcome! Please:

1. Fork the repo
2. Create a feature branch
3. Test locally
4. Submit a pull request

## License

MIT

## Support

- **Documentation**: See [README.md](README.md)
- **Issues**: [GitHub Issues](https://github.com/KeithDoolan-Git/EPM-Approver/issues)

---

**Version**: 1.0.0  
**Last Updated**: 2026-06-27  
**Status**: Production Ready
