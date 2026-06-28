import { ElevationRequest } from "./graph-client";

/**
 * Generates a mock elevation request for proof-of-concept / local testing.
 *
 * Used when MOCK_MODE=true so the full pipeline (email + approve/deny buttons)
 * can be demonstrated without a live Intune EPM endpoint, enrolled devices, or
 * deployed EPM policies.
 *
 * The id is stable per-day so repeated polls within the same day are
 * de-duplicated by the state manager (you get one email, not one per minute).
 */
export function getMockElevationRequests(): ElevationRequest[] {
  const now = new Date();
  const expires = new Date(now.getTime() + 24 * 60 * 60 * 1000);

  // Stable id for the current day, e.g. mock-req-2026-06-28
  const dayStamp = now.toISOString().slice(0, 10);
  const id = `mock-req-${dayStamp}`;

  return [
    {
      id,
      displayName: "C:\\Program Files\\WindowsApps\\AdminTool\\setup.exe",
      requestedBy: "jordan.lee@modernworkplacetech.com",
      requestedDevice: "MWT-LAPTOP-0427",
      justification:
        "Need to install an approved line-of-business application that requires administrator rights to complete its setup.",
      createdDateTime: now.toISOString(),
      status: "pending",
      requestExpiresDateTime: expires.toISOString(),
    },
  ];
}

export function getMockElevationRequestById(
  requestId: string
): ElevationRequest | null {
  const match = getMockElevationRequests().find((r) => r.id === requestId);
  if (match) return match;

  // Fall back to a generic mock so an approve/deny click always resolves,
  // even after the day's stable id has rolled over.
  return {
    id: requestId,
    displayName: "C:\\Program Files\\WindowsApps\\AdminTool\\setup.exe",
    requestedBy: "jordan.lee@modernworkplacetech.com",
    requestedDevice: "MWT-LAPTOP-0427",
    justification: "Mock elevation request (proof of concept).",
    createdDateTime: new Date().toISOString(),
    status: "pending",
    requestExpiresDateTime: new Date(
      Date.now() + 24 * 60 * 60 * 1000
    ).toISOString(),
  };
}
