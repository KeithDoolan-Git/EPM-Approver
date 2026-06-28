import { app } from "@azure/functions";
import pollElevationRequests from "./functions/poll-elevation-requests";
import processApproval from "./functions/process-approval";

// Register timer-triggered function
app.timer("pollElevationRequests", {
  schedule: "0 */1 * * * *", // Every minute
  handler: pollElevationRequests,
});

// Register HTTP-triggered function.
// Route is "approve" so the public URL is /api/approve, matching the
// approve/deny links embedded in the notification email.
app.http("processApproval", {
  route: "approve",
  methods: ["GET", "POST"],
  authLevel: "anonymous",
  handler: processApproval,
});
