# Local Testing Guide

This guide walks you through testing the EPM Notification Service locally using your own M365/Azure tenant.

## Prerequisites

- Node.js 20+ installed
- Azure CLI installed (`az --version`)
- Azure Functions Core Tools (`func --version`)
- PowerShell 5.1+ (for setup script)
- Visual Studio Code (recommended)
- Active M365/Azure subscription

## Phase 1: Prepare Azure Tenant

### 1.1 Login to Azure

```powershell
az login --tenant <your-tenant-id>
az account set --subscription <your-subscription-id>
```

Verify:
```powershell
az account show
```

### 1.2 Create Entra App Registration Manually (for testing)

You can either:
- **Option A**: Run the automated setup script
- **Option B**: Create manually (recommended for testing)

**Option B - Manual Creation:**

```powershell
# Create app registration
$app = az ad app create --display-name "EPM-Notification-Service-Test" | ConvertFrom-Json
$appId = $app.appId
$appObjectId = $app.id

Write-Host "App ID: $appId"

# Create service principal
$sp = az ad sp create --id $appId | ConvertFrom-Json
$spId = $sp.id

# Create client secret (save this!)
$secret = az ad app credential reset --id $appId --years 1 | ConvertFrom-Json
$clientSecret = $secret.password

Write-Host "Client Secret: $clientSecret"
Write-Host "IMPORTANT: Save these values!"

# Grant API permissions
# Mail.Send
az ad app permission add --id $appId --api 00000003-0000-0000-c000-000000000000 --api-permissions e1fe6dd8-ba31-4d61-89e7-88639da4683d=Scope

# Device.Read.All
az ad app permission add --id $appId --api 00000003-0000-0000-c000-000000000000 --api-permissions 7438b122-aeadda18-3842-4cb9-3f49-b6b2359caf16=Scope

# User.Read.All
az ad app permission add --id $appId --api 00000003-0000-0000-c000-000000000000 --api-permissions a154be20-db80-4a3d-a555-7b6a3d20e882=Scope

# Grant admin consent
az ad app permission admin-consent --id $appId

Write-Host "✓ App registration created and configured"
Write-Host ""
Write-Host "Next: Get your shared mailbox Object ID"
```

### 1.3 Find Shared Mailbox Object ID

```powershell
# List all users and filter for shared mailbox
az ad user list --query "[?displayName like 'EPM*' || mail like 'epm*'].{displayName:displayName, mail:mail, id:id}" -o table

# Or search directly
az ad user show --id "epm-approvals@yourtenant.onmicrosoft.com" --query id -o tsv
```

Save the Object ID for later.

## Phase 2: Local Development Setup

### 2.1 Install Dependencies

```bash
cd "C:\VS Projects\Elevated Privilege Management"

# Install Node packages
npm install

# Install Azure Functions Core Tools
npm install -g azure-functions-core-tools@4
```

### 2.2 Create .env File

```bash
# Copy the example
cp .env.example .env
```

Edit `.env` with your values:

```env
TENANT_ID=your-actual-tenant-id
CLIENT_ID=your-app-id-from-1.2
CLIENT_SECRET=your-client-secret-from-1.2
SHARED_MAILBOX_EMAIL=epm-approvals@yourtenant.onmicrosoft.com
SHARED_MAILBOX_ID=object-id-from-1.3
POLL_INTERVAL_MINUTES=1
TOKEN_EXPIRY_MINUTES=1440
WEBHOOK_URL=http://localhost:7071/api/approve
LOG_LEVEL=debug
NODE_ENV=development
```

**Note**: Set `POLL_INTERVAL_MINUTES=1` for faster testing

### 2.3 Build TypeScript

```bash
npm run build
```

Should output files to `dist/` folder.

## Phase 3: Test Locally

### 3.1 Run Azure Functions Locally

```bash
func start
```

You should see:

```
Azure Functions Core Tools (4.x.x)
...
Functions:
  pollElevationRequests: Timer trigger
  processApproval: HTTP trigger
    Functions Runtime endpoint: http://localhost:7071
```

### 3.2 Test Polling Function Manually

In a new terminal:

```powershell
# Trigger the poller immediately
curl -X POST http://localhost:7071/admin/functions/pollElevationRequests

# Check response
```

**Expected behavior:**
- Function logs to console
- Queries Intune EPM API for pending requests
- If no requests exist, exits gracefully

### 3.3 Create a Test Elevation Request in Intune

You'll need to manually create an elevation request in your test tenant. Unfortunately, there's no direct API to create test requests, so:

**Option 1: Create via Intune UI**
1. Go to **Intune** → **Endpoint Privilege Management** → **Elevation requests**
2. Create a test request manually through the process
3. Return to console and check if poller detects it

**Option 2: Create via Graph API (if supported)**
```powershell
# Try to create a test request (may not work if EPM API is limited)
$headers = @{
    Authorization = "Bearer $(az account get-access-token --query accessToken -o tsv)"
    "Content-Type" = "application/json"
}

$body = @{
    displayName = "C:\Windows\System32\cmd.exe"
    justification = "Testing EPM notification service"
} | ConvertTo-Json

Invoke-WebRequest `
  -Uri "https://graph.microsoft.com/beta/deviceManagement/elevation/elevationRequests" `
  -Method POST `
  -Headers $headers `
  -Body $body
```

**Option 3: Test Email Sending Only**
```powershell
# Jump to Phase 3.4 if no test request available
```

### 3.4 Test Approval Workflow

Once a request is detected and email sent:

1. **Check your shared mailbox** for the notification email
2. **Click [APPROVE] button** in the email
3. **Monitor console** for:
   - Token validation
   - Intune EPM API call
   - Confirmation email sent

**Expected console output:**
```
[2026-06-27T10:30:00.000Z] [INFO] Processing approval action
[2026-06-27T10:30:00.100Z] [INFO] Token validated for request-id-123
[2026-06-27T10:30:00.500Z] [INFO] Request approved successfully
[2026-06-27T10:30:01.000Z] [INFO] Confirmation email sent to requester
```

### 3.5 Test Denial Workflow

Similarly, click **[DENY]** button and verify the same flow.

## Phase 4: Debugging

### Enable Verbose Logging

In `.env`:
```env
LOG_LEVEL=debug
```

### Check Intune EPM API Response

Add temporary logging to `src/functions/poll-elevation-requests.ts`:

```typescript
const requests = await graphClient.getElevationRequests();
console.log("Raw API response:", JSON.stringify(requests, null, 2));
```

Then rebuild and run:
```bash
npm run build
func start
```

### Test Graph API Directly

```powershell
$token = az account get-access-token --query accessToken -o tsv

$headers = @{
    Authorization = "Bearer $token"
}

# Get elevation requests
Invoke-WebRequest `
  -Uri "https://graph.microsoft.com/beta/deviceManagement/elevation/elevationRequests" `
  -Headers $headers | ConvertTo-Json | Write-Output
```

### Email Not Sending?

Check if shared mailbox is accessible:

```powershell
$token = az account get-access-token --query accessToken -o tsv

$headers = @{
    Authorization = "Bearer $token"
}

# Test sending email to shared mailbox
$body = @{
    message = @{
        subject = "Test Email"
        body = @{
            contentType = "HTML"
            content = "<p>Test</p>"
        }
        toRecipients = @(@{
            emailAddress = @{
                address = "test@yourtenant.onmicrosoft.com"
            }
        })
    }
    saveToSentItems = $true
} | ConvertTo-Json -Depth 10

Invoke-WebRequest `
  -Uri "https://graph.microsoft.com/beta/users/epm-approvals@yourtenant.onmicrosoft.com/sendMail" `
  -Method POST `
  -Headers $headers `
  -Body $body `
  -ContentType "application/json"
```

## Phase 5: Verify Full Workflow

### Checklist

- [ ] App registration created with EPM permissions
- [ ] Entra credentials stored in `.env`
- [ ] Shared mailbox identified and Object ID found
- [ ] `npm run build` completes without errors
- [ ] `func start` launches without errors
- [ ] Polling function executes (manual trigger)
- [ ] Election requests detected from Intune EPM
- [ ] Email sent to shared mailbox
- [ ] Email includes [APPROVE] and [DENY] buttons
- [ ] Clicking [APPROVE] updates Intune EPM status
- [ ] Confirmation email sent to requester
- [ ] Audit log shows approval/denial action
- [ ] Clicking [DENY] works similarly

## Common Issues & Fixes

### Issue: "Missing required environment variable: TENANT_ID"

**Fix**: Ensure `.env` file exists and has all required variables:
```bash
cat .env
```

### Issue: "Failed to acquire access token"

**Fix**: Check credentials:
```powershell
az login --tenant $TENANT_ID
az account show
```

### Issue: "Request not found" when approving

**Fix**: Token may have expired. Ensure `TOKEN_EXPIRY_MINUTES` is large enough:
```env
TOKEN_EXPIRY_MINUTES=1440
```

### Issue: Email not appearing in shared mailbox

**Fix**: Check if app has permission to send as shared mailbox:
```powershell
# Verify service principal has permissions
az ad app permission list --id $CLIENT_ID

# Ensure admin consent is granted
az ad app permission admin-consent --id $CLIENT_ID
```

### Issue: "CORS error" or "401 Unauthorized"

**Fix**: Ensure `WEBHOOK_URL` is correct:
```env
WEBHOOK_URL=http://localhost:7071/api/approve
```

If testing from a different machine, use ngrok:
```bash
ngrok http 7071
# Then update WEBHOOK_URL=https://your-ngrok-url/api/approve
```

## Testing Checklist

Before moving to production:

- [ ] **Unit Tests**: Run `npm test` (tests in `src/__tests__/`)
- [ ] **Integration Tests**: Full workflow end-to-end with real Intune tenant
- [ ] **Error Handling**: Try with invalid tokens, expired requests, missing permissions
- [ ] **Performance**: Monitor memory/CPU usage during polling
- [ ] **Security**: Verify tokens are signed and validated
- [ ] **Logging**: All actions appear in console with proper timestamps

## Next Steps After Testing

1. ✅ Tests pass → Ready for Azure deployment
2. ✅ Fix any bugs found → Re-test
3. ✅ Document findings → Update README.md
4. ✅ Push to GitHub → Create release
5. ✅ Build installer → `makensis setup/installer.nsi`
6. ✅ Upload to releases page

---

**Testing Duration**: ~30-45 minutes (one full cycle through all workflows)

**Need Help?**
- Check console logs for error messages
- Enable `LOG_LEVEL=debug` for verbose output
- Run manual Graph API tests to isolate issues
