import axios, { AxiosInstance } from "axios";
import { AppConfig } from "./config-loader";
import { info, error, debug } from "./logger";

export interface ElevationRequest {
  id: string;
  displayName: string;
  requestedBy: string;
  requestedDevice: string;
  justification: string;
  createdDateTime: string;
  status: "pending" | "approved" | "denied" | "expired";
  requestExpiresDateTime: string;
  approvalComments?: string;
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
    try {
      const token = await this.ensureTokenValid();

      const response = await this.client.get(
        "/deviceManagement/elevation/elevationRequests",
        {
          headers: {
            Authorization: `Bearer ${token}`,
          },
          params: {
            $filter: "status eq 'pending'",
          },
        }
      );

      const requests = response.data.value || [];
      debug(`Retrieved ${requests.length} pending elevation requests`, {
        count: requests.length,
      });

      return requests;
    } catch (err) {
      error("Failed to get elevation requests", err);
      return [];
    }
  }

  async getElevationRequest(requestId: string): Promise<ElevationRequest | null> {
    try {
      const token = await this.ensureTokenValid();

      const response = await this.client.get(
        `/deviceManagement/elevation/elevationRequests/${requestId}`,
        {
          headers: {
            Authorization: `Bearer ${token}`,
          },
        }
      );

      return response.data;
    } catch (err) {
      error(`Failed to get elevation request ${requestId}`, err);
      return null;
    }
  }

  async approveRequest(
    requestId: string,
    comment?: string
  ): Promise<boolean> {
    try {
      const token = await this.ensureTokenValid();

      await this.client.post(
        `/deviceManagement/elevation/elevationRequests/${requestId}/approve`,
        {
          approvalComments: comment,
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
      error(`Failed to approve request ${requestId}`, err);
      return false;
    }
  }

  async denyRequest(requestId: string, reason?: string): Promise<boolean> {
    try {
      const token = await this.ensureTokenValid();

      await this.client.post(
        `/deviceManagement/elevation/elevationRequests/${requestId}/deny`,
        {
          denialReason: reason,
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
      error(`Failed to deny request ${requestId}`, err);
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
      error(`Failed to send email to ${toAddress}`, err);
      return false;
    }
  }
}
