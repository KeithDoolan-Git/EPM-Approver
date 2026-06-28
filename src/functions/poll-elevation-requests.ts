import { Timer } from "@azure/functions";
import * as crypto from "crypto";
import { loadConfig, validateConfig } from "../lib/config-loader";
import { GraphClient } from "../lib/graph-client";
import { StateManager } from "../lib/state-manager";
import { generateApprovalToken } from "../lib/token-manager";
import { generateApprovalEmailHtml } from "../lib/email-template";
import { info, error, setLogLevel } from "../lib/logger";

async function timerTrigger(myTimer: Timer): Promise<void> {
  try {
    const config = loadConfig();
    validateConfig(config);
    setLogLevel(config.logLevel);

    info("Starting elevation request polling");

    // Initialize services
    const graphClient = new GraphClient(config);
    const stateManager = new StateManager("/tmp/epm");
    await stateManager.initialize();

    // Fetch pending requests from Intune
    const requests = await graphClient.getElevationRequests();
    info(`Found ${requests.length} pending elevation requests`);

    if (requests.length === 0) {
      info("No pending requests");
      return;
    }

    // Process each request
    for (const request of requests) {
      try {
        // Check if already notified
        if (stateManager.isRequestNotified(request.id)) {
          info(`Request ${request.id} already notified`);
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

          info(`Sent notification for request ${request.id}`);
          console.log({
            requester: request.requestedBy,
            device: request.requestedDevice,
            application: request.displayName,
          });
        } else {
          error(`Failed to send notification for request ${request.id}`);
        }
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        error(`Error processing request ${request.id}: ${msg}`);
      }
    }

    // Cleanup old state entries
    stateManager.clearOldEntries(30);
    await stateManager.save();

    info("Polling cycle completed");
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    error(`Fatal error in polling function: ${msg}`);
    throw err;
  }
}

function calculateRequestHash(obj: any): string {
  const json = JSON.stringify(obj);
  return crypto.createHash("sha256").update(json).digest("hex");
}

export default timerTrigger;
