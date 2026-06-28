import axios, { AxiosInstance } from "axios";
import { AppConfig } from "./config-loader";
import { info, error, debug } from "./logger";
import {
  getMockElevationRequests,
  getMockElevationRequestById,
} from "./mock-data";

/**
 * Extracts a concise, human-readable summary from an error so we log the
 * useful bits (HTTP status + Graph error message) instead of dumping the
 * entire axios object to the console.
 */
function describeError(err: any): string {
  if (axios.isAxiosError(err)) {
    const status = err.response?.status;
    const graphError = (err.response?.data as any)?.error;
    const message = graphError?.message || err.message;
    const code = graphError?.code ? ` [${graphError.code}]` : "";
    return `HTTP ${status ?? "?"}${code}: ${message}`;
  }
  return err instanceof Error ? err.message : String(err);
}

/**
 * Normalized elevation request used throughout the app (email templates,
 * poller, approval handler). This is mapped from the raw Graph resource
 * (privilegeManagementElevationRequest) by `mapRawRequest`.
 */
export interface ElevationRequest {
  id: string;
  displayName: string;
  requestedBy: string;
  requestedDevice: string;
  justification: string;
  createdDateTime: string;
  status: "none" | "pending" | "approved" | "denied" | "expired" | "revoked" | "completed";
  requestExpiresDateTime: string;
  approvalComments?: string;
}

/**
 * Raw shape of the Graph beta privilegeManagementElevationRequest resource.
 * See: https://learn.microsoft.com/en-us/graph/api/resources/intune-epmgraphapiservice-privilegemanagementelevationrequest?view=graph-rest-beta
 */
interface RawElevationRequest {
  id: string;
  requestedByUserPrincipalName?: string;
  requestedByUserId?: string;
  deviceName?: string;
  requestCreatedDateTime?: string;
  requestJustification?: string;
  requestExpiryDateTime?: string;
  status?: string;
  reviewerJustification?: string;
  applicationDetail?: {
    fileName?: string;
    filePath?: string;
    fileDescription?: string;
    productName?: string;
    publisherName?: string;
  };
}

function mapRawRequest(raw: RawElevationRequest): ElevationRequest {
  const app = raw.applicationDetail || {};
  const appName =
    app.fileName ||
    app.productName ||
    app.fileDescription ||
    app.filePath ||
    "(unknown application)";

  return {
    id: raw.id,
    displayName: app.filePath ? `${appName} (${app.filePath})` : appName,
    requestedBy: raw.requestedByUserPrincipalName || raw.requestedByUserId || "(unknown user)",
    requestedDevice: raw.deviceName || "(unknown device)",
    justification: raw.requestJustification || "(no justification provided)",
    createdDateTime: raw.requestCreatedDateTime || new Date().toISOString(),
    status: (raw.status as ElevationRequest["status"]) || "none",
    requestExpiresDateTime:
      raw.requestExpiryDateTime ||
      new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(),
    approvalComments: raw.reviewerJustification,
  };
}

export class GraphClient {
  private client: AxiosInstance;
  private accessToken: string = "";
  private tokenExpiry: number = 0;
  private config: AppConfig;

  constructor(config: AppConfig) {
    this.config = config;
    this.client = axios.create({
      baseURL: "https://graph.microsoft.com/beta",
      timeout: 10000,
    });
  }

  private async ensureTokenValid(): Promise<string> {
    const now = Date.now();

    // If token exists and not expired, use it
    if (this.accessToken && this.tokenExpiry > now) {
      return this.accessToken;
    }

    // Request new token
    const tokenUrl = `https://login.microsoftonline.com/${this.config.tenantId}/oauth2/v2.0/token`;

    const params = new URLSearchParams({
      client_id: this.config.clientId,
      client_secret: this.config.clientSecret,
      scope: "https://graph.microsoft.com/.default",
      grant_type: "client_credentials",
    });

    try {
      const response = await axios.post(tokenUrl, params.toString(), {
        headers: {
          "Content-Type": "application/x-www-form-urlencoded",
        },
      });

      this.accessToken = response.data.access_token;
      this.tokenExpiry = now + response.data.expires_in * 1000 - 60000; // Refresh 1min before expiry

      debug(`Access token acquired, expires in ${response.data.expires_in}s`, {
        expiresIn: response.data.expires_in,
      });
      return this.accessToken;
    } catch (err) {
      error("Failed to acquire access token", err);
      throw err;
    }
  }

  async getElevationRequests(): Promise<ElevationRequest[]> {
    if (this.config.mockMode) {
      const mock = getMockElevationRequests();
      info(`[MOCK MODE] Returning ${mock.length} mock elevation request(s)`);
      return mock;
    }

    try {
      const token = await this.ensureTokenValid();

      const response = await this.client.get(
        "/deviceManagement/elevationRequests",
        {
          headers: {
            Authorization: `Bearer ${token}`,
            Accept: "application/json",
          },
        }
      );

      const raw: RawElevationRequest[] = response.data.value || [];

      // Filter to pending client-side (the API doesn't reliably support
      // $filter on status) and normalize to our internal shape.
      const pending = raw
        .filter((r) => r.status === "pending")
        .map(mapRawRequest);

      debug(
        `Retrieved ${raw.length} elevation request(s), ${pending.length} pending`,
        { total: raw.length, pending: pending.length }
      );

      return pending;
    } catch (err) {
      error(`Failed to get elevation requests: ${describeError(err)}`);
      return [];
    }
  }

  async getElevationRequest(requestId: string): Promise<ElevationRequest | null> {
    if (this.config.mockMode) {
      return getMockElevationRequestById(requestId);
    }

    try {
      const token = await this.ensureTokenValid();

      const response = await this.client.get(
        `/deviceManagement/elevationRequests/${requestId}`,
        {
          headers: {
            Authorization: `Bearer ${token}`,
            Accept: "application/json",
          },
        }
      );

      return mapRawRequest(response.data as RawElevationRequest);
    } catch (err) {
      error(
        `Failed to get elevation request ${requestId}: ${describeError(err)}`
      );
      return null;
    }
  }

  async approveRequest(
    requestId: string,
    comment?: string
  ): Promise<boolean> {
    if (this.config.mockMode) {
      info(`[MOCK MODE] Approved elevation request: ${requestId}`);
      return true;
    }

    try {
      const token = await this.ensureTokenValid();

      await this.client.post(
        `/deviceManagement/elevationRequests/${requestId}/approve`,
        {
          reviewerJustification: comment || "",
        },
        {
          headers: {
            Authorization: `Bearer ${token}`,
            "Content-Type": "application/json",
          },
        }
      );

      info(`Approved elevation request: ${requestId}`);
      return true;
    } catch (err) {
      error(`Failed to approve request ${requestId}: ${describeError(err)}`);
      return false;
    }
  }

  async denyRequest(requestId: string, reason?: string): Promise<boolean> {
    if (this.config.mockMode) {
      info(`[MOCK MODE] Denied elevation request: ${requestId}`);
      return true;
    }

    try {
      const token = await this.ensureTokenValid();

      await this.client.post(
        `/deviceManagement/elevationRequests/${requestId}/deny`,
        {
          reviewerJustification: reason || "",
        },
        {
          headers: {
            Authorization: `Bearer ${token}`,
            "Content-Type": "application/json",
          },
        }
      );

      info(`Denied elevation request: ${requestId}`);
      return true;
    } catch (err) {
      error(`Failed to deny request ${requestId}: ${describeError(err)}`);
      return false;
    }
  }

  async sendEmail(
    toAddress: string,
    subject: string,
    htmlBody: string
  ): Promise<boolean> {
    try {
      const token = await this.ensureTokenValid();

      const mailPayload = {
        message: {
          subject,
          body: {
            contentType: "HTML",
            content: htmlBody,
          },
          toRecipients: [
            {
              emailAddress: {
                address: toAddress,
              },
            },
          ],
        },
        saveToSentItems: true,
      };

      // Send as shared mailbox
      const endpoint = this.config.sharedMailboxId
        ? `/users/${this.config.sharedMailboxId}/sendMail`
        : `/users/${this.config.sharedMailboxEmail}/sendMail`;

      await this.client.post(endpoint, mailPayload, {
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
        },
      });

      info(`Email sent to ${toAddress}`);
      return true;
    } catch (err) {
      error(`Failed to send email to ${toAddress}: ${describeError(err)}`);
      return false;
    }
  }
}
