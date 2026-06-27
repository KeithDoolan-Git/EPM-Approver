import jwt from "jsonwebtoken";
import { AppConfig } from "./config-loader";

export interface ApprovalToken {
  iss: string;
  sub: string;
  requestId: string;
  action: "approve" | "deny";
  exp: number;
  iat: number;
}

export function generateApprovalToken(
  requestId: string,
  action: "approve" | "deny",
  config: AppConfig
): string {
  const now = Math.floor(Date.now() / 1000);
  const expirySeconds = config.tokenExpiryMinutes * 60;

  const token: ApprovalToken = {
    iss: "epm-notification-service",
    sub: `elevation-request-${requestId}`,
    requestId,
    action,
    iat: now,
    exp: now + expirySeconds,
  };

  return jwt.sign(token, config.clientSecret, {
    algorithm: "HS256",
  });
}

export function verifyApprovalToken(
  token: string,
  config: AppConfig
): ApprovalToken | null {
  try {
    const decoded = jwt.verify(token, config.clientSecret, {
      algorithms: ["HS256"],
    }) as ApprovalToken;

    // Validate token structure
    if (!decoded.requestId || !decoded.action) {
      return null;
    }

    return decoded;
  } catch (err) {
    return null;
  }
}

export function extractTokenFromUrl(url: string): string | null {
  try {
    const urlObj = new URL(url);
    return urlObj.searchParams.get("token");
  } catch {
    return null;
  }
}
