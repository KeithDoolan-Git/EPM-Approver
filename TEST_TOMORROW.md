# Real EPM Test — Runbook

A focused checklist to test the service against **real** Intune EPM elevation
requests, running locally on this PC.

---

## Before you start — one-time check

**Confirm the EPM permission is granted** (this is the permission that reads &
approves elevation requests — different from the email permission):

1. Azure Portal → **App registrations** → **EPM-Notification-Service** → **API permissions**
2. You should see **`DeviceManagementConfiguration.ReadWrite.All`** (Application) with
   a green "Granted for …" status.
3. If it's missing or not consented: **Add a permission** → Microsoft Graph →
   Application permissions → add it → **Grant admin consent**.

You should also still have **`Mail.Send`** (Application) granted.

---

## Step 1 — Start the service

In PowerShell:

```powershell
cd "C:\VS Projects\Elevated Privilege Management"
.\scripts\start-local.ps1
```

This frees port 7071, starts Azurite, rebuilds, and launches the host. Leave it
running. You should see:

```
Functions:
        processApproval: [GET,POST] http://localhost:7071/api/approve
        pollElevationRequests: timerTrigger
```

The poller runs **every minute**. To trigger it on demand, open a second
terminal and run:

```powershell
curl -X POST http://localhost:7071/admin/functions/pollElevationRequests
```

---

## Step 2 — Generate a real elevation request

On an Intune-managed device with an EPM **support-approved** elevation policy:

1. Right-click a file (e.g. an installer) → **Run with elevated access**
2. Submit the request with a justification

This creates a `pending` request in Intune that the poller will pick up.

---

## Step 3 — Watch the poll detect it

In the host console you should see (no HTTP 400 anymore):

```
[INFO] Starting elevation request polling
[DEBUG] Retrieved 1 elevation request(s), 1 pending
[INFO] Found 1 pending elevation requests
[INFO] Email sent to EPM-Approvers@modernworkplacetech.com
[INFO] Sent notification for request <real-guid>
```

---

## Step 4 — Approve / Deny from the email

1. Open the **EPM-Approvers** shared mailbox and find the notification email
2. Verify the details are correct (requester, device, file, justification)
3. Click **APPROVE** (or **DENY**)

> Important: click the button **on this PC** while the host is running — the
> links point to `http://localhost:7071`. (In the deployed Azure version the
> links are a public URL, so approvers can click from anywhere.)

You should see a confirmation page, and in the console:

```
[INFO] Processing approval action
[INFO] Approved elevation request: <real-guid>
[INFO] Email sent to <requester-upn>
```

---

## Step 5 — Verify in Intune

- Intune admin center → **Endpoint Privilege Management** → **Elevation requests**
- The request status should now be **Approved** / **Denied**
- The device should receive the policy (approval) within the normal EPM sync window

---

## If something fails

| Symptom | Likely cause / fix |
|---|---|
| `HTTP 403` on poll | `DeviceManagementConfiguration.ReadWrite.All` not granted/consented |
| `HTTP 400` on poll | Endpoint/field issue — capture the concise error line and share it |
| `0 pending` but you made a request | Request may already be approved/expired, or device not synced yet |
| Email never arrives | Check `Mail.Send` is granted; check console for a send error line |
| Approve button → can't reach page | Host not running, or you clicked from a different PC than the host |
| Port 7071 in use | `start-local.ps1` frees it automatically; or re-run it |

---

## Current local config (local.settings.json)

- `MOCK_MODE = false` (real EPM)
- `POLL_INTERVAL_MINUTES = 1`
- `WEBHOOK_URL = http://localhost:7071/api/approve` (local only)
- `LOG_LEVEL = debug`

When you're ready for a real multi-approver deployment (public webhook), use
`setup\deploy.ps1` to push everything to Azure Functions.
