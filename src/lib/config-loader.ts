import * as dotenv from "dotenv";

dotenv.config();

export interface AppConfig {
  tenantId: string;
  clientId: string;
  clientSecret: string;
  sharedMailboxEmail: string;
  sharedMailboxId?: string;
  pollIntervalMinutes: number;
  tokenExpiryMinutes: number;
  webhookUrl: string;
  logLevel: "debug" | "info" | "warn" | "error";
  stateStorageConnection?: string;
}

function getEnvVar(key: string, defaultValue?: string): string {
  const value = process.env[key];
  if (!value && !defaultValue) {
    throw new Error(`Missing required environment variable: ${key}`);
  }
  return value || defaultValue!;
}

export function loadConfig(): AppConfig {
  return {
    tenantId: getEnvVar("TENANT_ID"),
    clientId: getEnvVar("CLIENT_ID"),
    clientSecret: getEnvVar("CLIENT_SECRET"),
    sharedMailboxEmail: getEnvVar("SHARED_MAILBOX_EMAIL"),
    sharedMailboxId: process.env.SHARED_MAILBOX_ID,
    pollIntervalMinutes: parseInt(
      getEnvVar("POLL_INTERVAL_MINUTES", "5")
    ),
    tokenExpiryMinutes: parseInt(
      getEnvVar("TOKEN_EXPIRY_MINUTES", "1440")
    ),
    webhookUrl: getEnvVar("WEBHOOK_URL"),
    logLevel: (getEnvVar("LOG_LEVEL", "info") as any),
    stateStorageConnection: process.env.STATE_STORAGE_CONNECTION,
  };
}

export function validateConfig(config: AppConfig): void {
  if (!config.tenantId) throw new Error("TENANT_ID is required");
  if (!config.clientId) throw new Error("CLIENT_ID is required");
  if (!config.clientSecret) throw new Error("CLIENT_SECRET is required");
  if (!config.sharedMailboxEmail)
    throw new Error("SHARED_MAILBOX_EMAIL is required");
  if (!config.webhookUrl) throw new Error("WEBHOOK_URL is required");
}
