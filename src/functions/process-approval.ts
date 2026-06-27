import { HttpRequest, HttpResponseInit } from "@azure/functions";
import { loadConfig, validateConfig } from "../lib/config-loader";
import { GraphClient } from "../lib/graph-client";
import { verifyApprovalToken } from "../lib/token-manager";
import { StateManager } from "../lib/state-manager";
import { generateConfirmationEmailHtml } from "../lib/email-template";
import { info, error, warn, setLogLevel } from "../lib/logger";

async function processApproval(
  request: HttpRequest
): Promise<HttpResponseInit> {
  try {
    const config = loadConfig();
    validateConfig(config);
    setLogLevel(config.logLevel);

    info("Processing approval action");

    // Extract query parameters
    const url = new URL(request.url);
    const token = url.searchParams.get("token");
    const action = url.searchParams.get("action");

    if (!token) {
      warn("Missing token in request");
      return {
        status: 400,
        body: "Missing approval token",
      };
    }

    if (!action || !["approve", "deny"].includes(action)) {
      warn(`Invalid action: ${action}`);
      return {
        status: 400,
        body: "Invalid action. Use 'approve' or 'deny'",
      };
    }

    // Verify token signature and expiry
    const decodedToken = verifyApprovalToken(token, config);
    if (!decodedToken) {
      warn("Invalid or expired token");
      return {
        status: 401,
        body: "Token is invalid or expired",
      };
    }

    if (decodedToken.action !== action) {
      warn(
        `Token action mismatch: expected ${decodedToken.action}, got ${action}`
      );
      return {
        status: 400,
        body: "Token action mismatch",
      };
    }

    const requestId = decodedToken.requestId;

    // Initialize services
    const graphClient = new GraphClient(config);
    const stateManager = new StateManager("/tmp/epm");
    await stateManager.initialize();

    // Fetch full request details
    const req = await graphClient.getElevationRequest(requestId);
    if (!req) {
      error(`Request not found: ${requestId}`);
      return {
        status: 404,
        body: "Request not found or already processed",
      };
    }

    // Process approval or denial
    let success = false;
    if (action === "approve") {
      success = await graphClient.approveRequest(
        requestId,
        "Approved via email notification service"
      );
    } else {
      success = await graphClient.denyRequest(
        requestId,
        "Denied via email notification service"
      );
    }

    if (!success) {
      error(`Failed to ${action} request ${requestId}`);
      return {
        status: 500,
        body: `Failed to ${action} the request. Please try again or use Intune directly.`,
      };
    }

    // Update state
    stateManager.updateRequestStatus(
      requestId,
      action === "approve" ? "approved" : "denied"
    );
    await stateManager.save();

    // Send confirmation email to requester
    const confirmationHtml = generateConfirmationEmailHtml(
      req,
      action as "approved" | "denied",
      config.sharedMailboxEmail
    );

    await graphClient.sendEmail(
      req.requestedBy,
      `[EPM] Your elevation request was ${action}`,
      confirmationHtml
    );

    info(`Request ${action}ed successfully: ${requestId}`);

    // Return success response
    return {
      status: 200,
      body: `
        <html>
          <head>
            <meta charset="UTF-8">
            <style>
              body { font-family: Segoe UI, Arial, sans-serif; text-align: center; padding: 40px; background: #f5f5f5; }
              .container { max-width: 600px; margin: 0 auto; background: white; padding: 30px; border-radius: 8px; box-shadow: 0 2px 10px rgba(0,0,0,0.1); }
              .success { color: #107c10; }
              .denied { color: #d83b01; }
              h1 { margin: 0 0 20px 0; }
              p { color: #333; line-height: 1.6; }
              .footer { font-size: 12px; color: #999; margin-top: 20px; }
            </style>
          </head>
          <body>
            <div class="container">
              <h1 class="${action === "approve" ? "success" : "denied"}">
                ${action === "approve" ? "✓ Request Approved" : "✗ Request Denied"}
              </h1>
              <p>The elevation request has been successfully ${action}ed.</p>
              <p>The requester will be notified by email.</p>
              <p><strong>Request ID:</strong> ${requestId}</p>
              <div class="footer">
                <p>You can close this window. No further action is required.</p>
              </div>
            </div>
          </body>
        </html>
      `,
      headers: {
        "Content-Type": "text/html; charset=utf-8",
      },
    };
  } catch (err) {
    error("Fatal error in approval handler");
    console.error(err);
    return {
      status: 500,
      body: "An unexpected error occurred",
    };
  }
}

export default processApproval;
