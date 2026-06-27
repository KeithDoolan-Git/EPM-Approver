import { AzureFunction, Context } from "@azure/functions";

export type LogLevel = "debug" | "info" | "warn" | "error";

const levels: Record<LogLevel, number> = {
  debug: 0,
  info: 1,
  warn: 2,
  error: 3,
};

let currentLogLevel: LogLevel = "info";

export function setLogLevel(level: LogLevel): void {
  currentLogLevel = level;
}

export function log(
  level: LogLevel,
  message: string,
  context?: Context,
  data?: any
): void {
  if (levels[level] < levels[currentLogLevel]) return;

  const timestamp = new Date().toISOString();
  const prefix = `[${timestamp}] [${level.toUpperCase()}]`;

  if (data) {
    console.log(`${prefix} ${message}`, data);
    context?.log(`${prefix} ${message}`, data);
  } else {
    console.log(`${prefix} ${message}`);
    context?.log(`${prefix} ${message}`);
  }
}

export function debug(message: string, context?: Context, data?: any): void {
  log("debug", message, context, data);
}

export function info(message: string, context?: Context, data?: any): void {
  log("info", message, context, data);
}

export function warn(message: string, context?: Context, data?: any): void {
  log("warn", message, context, data);
}

export function error(message: string, context?: Context, data?: any): void {
  log("error", message, context, data);
}
