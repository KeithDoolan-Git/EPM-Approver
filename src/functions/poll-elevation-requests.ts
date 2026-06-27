import { AzureFunction, Context, Timer } from "@azure/functions";
import * as crypto from "crypto";
import { loadConfig, validateConfig } from "../lib/config-loader";
import { GraphClient } from "../lib/graph-client";
import { StateManager } from "../lib/state-manager";
import { generateApprovalToken } from "../lib/token-manager";
import { generateApprovalEmailHtml } from "../lib/email-template";
import { info, error, setLogLevel } from "../lib/logger";

const timerTrigger: AzureFunction = async function (
  context: Context,
  myTimer: Timer
): Promise<void> {
  try {
    const config = loadConfig();
    validateConfig(config);
    setLogLevel(config.logLevel);

    info("Starting elevation request polling", context);

    // Initialize services
    const graphClient = new GraphClient(config);
    const stateManager = new StateManager("/tmp/epm");
    await stateManager.initialize();

    // Fetch pending requests from Intune
    const requests = await graphClient.getElevationRequests();
    info(`Found ${requests.length} pending elevation requests`, context);

    if (requests.length === 0) {
      info("No pending requests", context);
      return;
    }

    // Process each request
    for (const request of requests) {
      try {
        // Check if already notified
        if (stateManager.isRequestNotified(request.id)) {
          info(`Request ${request.id} already notified`, context);
          continue;
        }

        // Calculate hash of request for change detection
        const requestHash = calculateRequestHash(request);

        // Generate approval/denial tokens
        const approveToken = generateApprovalToken(request.id, "approve", config);
        const denyToken = generateApprovalToken(request.id, "deny", config);

        // Generate email HTML
        const emailHtml = generateApprovalEmailHtml(
          request,
          approveToken,
          denyToken,
          config
        );

        // Send email to shared mailbox
        const emailSent = await graphClient.sendEmail(
          config.sharedMailboxEmail,
          `[EPM] Elevation Request: ${request.displayName}`,
          emailHtml
        );

        if (emailSent) {
          // Mark request as notified
          stateManager.markRequestNotified(request.id, requestHash, "pending");
          await stateManager.save();

          info(`Sent notification for request ${request.id}`, context, {
            requester: request.requestedBy,
            device: request.requestedDevice,
            application: request.displayName,
          });
        } else {
          error(
            `Failed to send notification for request ${request.id}`,
            context
          );
        }
      } catch (err) {
        error(
          `Error processing request ${request.id}`,
          context,
          err
        );
      }
    }

    // Cleanup old state entries
    stateManager.clearOldEntries(30);
    await stateManager.save();

    info("Polling cycle completed", context);
  } catch (err) {
    error("Fatal error in polling function", context, err);
    throw err;
  }
};

function calculateRequestHash(obj: any): string {
  const json = JSON.stringify(obj);
  return crypto.createHash("sha256").update(json).digest("hex");
}

export default timerTrigger;
