import { ElevationRequest } from "./graph-client";
import { AppConfig } from "./config-loader";

export function generateApprovalEmailHtml(
  request: ElevationRequest,
  approveToken: string,
  denyToken: string,
  config: AppConfig
): string {
  const approveLinkUrl = new URL(config.webhookUrl);
  approveLinkUrl.searchParams.set("action", "approve");
  approveLinkUrl.searchParams.set("token", approveToken);

  const denyLinkUrl = new URL(config.webhookUrl);
  denyLinkUrl.searchParams.set("action", "deny");
  denyLinkUrl.searchParams.set("token", denyToken);

  const expiresAt = new Date(request.requestExpiresDateTime);
  const timeRemaining = formatTimeRemaining(new Date(request.createdDateTime), expiresAt);

  return `
<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8">
  <style>
    body { font-family: Segoe UI, Arial, sans-serif; color: #333; }
    .container { max-width: 600px; margin: 0 auto; padding: 20px; }
    .header { background: linear-gradient(135deg, #0078d4 0%, #0063b1 100%); color: white; padding: 20px; border-radius: 8px 8px 0 0; }
    .content { background: #f5f5f5; padding: 20px; border-radius: 0 0 8px 8px; }
    .request-details { background: white; padding: 15px; border-left: 4px solid #0078d4; margin: 15px 0; }
    .detail-row { margin: 10px 0; }
    .detail-label { font-weight: bold; color: #0078d4; min-width: 120px; display: inline-block; }
    .detail-value { color: #333; }
    .buttons { margin: 20px 0; text-align: center; }
    .btn { display: inline-block; padding: 12px 30px; margin: 0 10px; text-decoration: none; border-radius: 4px; font-weight: bold; }
    .btn-approve { background: #107c10; color: white; }
    .btn-deny { background: #d83b01; color: white; }
    .btn:hover { opacity: 0.9; }
    .footer { font-size: 12px; color: #666; margin-top: 20px; text-align: center; }
    .warning { background: #fff4ce; border: 1px solid #ffe680; padding: 10px; border-radius: 4px; margin: 10px 0; }
  </style>
</head>
<body>
  <div class="container">
    <div class="header">
      <h2 style="margin: 0;">🔐 Elevation Request Approval Required</h2>
    </div>

    <div class="content">
      <p>A user has requested elevated privileges. Please review and respond within the allocated time.</p>

      <div class="request-details">
        <div class="detail-row">
          <span class="detail-label">Requester:</span>
          <span class="detail-value">${escapeHtml(request.requestedBy)}</span>
        </div>
        <div class="detail-row">
          <span class="detail-label">Device:</span>
          <span class="detail-value">${escapeHtml(request.requestedDevice)}</span>
        </div>
        <div class="detail-row">
          <span class="detail-label">File/Application:</span>
          <span class="detail-value"><code>${escapeHtml(request.displayName)}</code></span>
        </div>
        <div class="detail-row">
          <span class="detail-label">Justification:</span>
          <span class="detail-value">${escapeHtml(request.justification)}</span>
        </div>
        <div class="detail-row">
          <span class="detail-label">Requested At:</span>
          <span class="detail-value">${new Date(request.createdDateTime).toLocaleString()}</span>
        </div>
        <div class="detail-row">
          <span class="detail-label">Expires At:</span>
          <span class="detail-value">${expiresAt.toLocaleString()}</span>
        </div>
      </div>

      <div class="warning">
        <strong>⏱️ Time Remaining:</strong> ${timeRemaining}
      </div>

      <div class="buttons">
        <a href="${approveLinkUrl.toString()}" class="btn btn-approve">✓ APPROVE</a>
        <a href="${denyLinkUrl.toString()}" class="btn btn-deny">✗ DENY</a>
      </div>

      <p style="font-style: italic; color: #666; font-size: 14px;">
        Approval links expire in 24 hours. For any questions, contact your IT administrator.
      </p>

      <div class="footer">
        <p style="margin: 10px 0;">
          <a href="https://intune.microsoft.com" style="color: #0078d4; text-decoration: none;">View in Intune</a>
        </p>
        <p style="margin: 10px 0; color: #999;">
          This is an automated message. Do not reply to this email.
        </p>
      </div>
    </div>
  </div>
</body>
</html>
  `;
}

export function generateConfirmationEmailHtml(
  request: ElevationRequest,
  action: "approved" | "denied",
  approverEmail: string
): string {
  const actionText = action === "approved" ? "approved" : "denied";
  const actionEmoji = action === "approved" ? "✓" : "✗";
  const bgColor = action === "approved" ? "#107c10" : "#d83b01";

  return `
<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8">
  <style>
    body { font-family: Segoe UI, Arial, sans-serif; color: #333; }
    .container { max-width: 600px; margin: 0 auto; padding: 20px; }
    .header { background: ${bgColor}; color: white; padding: 20px; border-radius: 8px 8px 0 0; text-align: center; }
    .content { background: #f5f5f5; padding: 20px; border-radius: 0 0 8px 8px; }
    .detail { background: white; padding: 15px; border-left: 4px solid ${bgColor}; margin: 15px 0; }
    .footer { font-size: 12px; color: #666; margin-top: 20px; text-align: center; }
  </style>
</head>
<body>
  <div class="container">
    <div class="header">
      <h2 style="margin: 0;">${actionEmoji} Your Request Was ${actionText.toUpperCase()}</h2>
    </div>

    <div class="content">
      <p>Your elevation request has been <strong>${actionText}</strong>.</p>

      <div class="detail">
        <p><strong>Request Details:</strong></p>
        <p>Application: <code>${escapeHtml(request.displayName)}</code></p>
        <p>Device: ${escapeHtml(request.requestedDevice)}</p>
        <p>Approved by: ${escapeHtml(approverEmail)}</p>
        <p>Time: ${new Date().toLocaleString()}</p>
      </div>

      ${action === "approved" ? `
        <p style="background: #e7f3ec; padding: 10px; border-radius: 4px;">
          You can now run the application with elevated privileges. This permission lasts for 24 hours.
        </p>
      ` : `
        <p style="background: #fde7e9; padding: 10px; border-radius: 4px;">
          If you believe this was denied in error, please contact your IT administrator.
        </p>
      `}

      <div class="footer">
        <p>This is an automated message. Do not reply to this email.</p>
      </div>
    </div>
  </div>
</body>
</html>
  `;
}

function escapeHtml(text: string): string {
  const map: Record<string, string> = {
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#039;",
  };
  return text.replace(/[&<>"']/g, (m) => map[m]);
}

function formatTimeRemaining(createdDate: Date, expiresDate: Date): string {
  const now = new Date();
  const diffMs = expiresDate.getTime() - now.getTime();

  if (diffMs <= 0) {
    return "Expired";
  }

  const hours = Math.floor(diffMs / (1000 * 60 * 60));
  const minutes = Math.floor((diffMs % (1000 * 60 * 60)) / (1000 * 60));

  if (hours > 0) {
    return `${hours} hour${hours > 1 ? "s" : ""} and ${minutes} minute${minutes > 1 ? "s" : ""}`;
  }

  return `${minutes} minute${minutes > 1 ? "s" : ""}`;
}
