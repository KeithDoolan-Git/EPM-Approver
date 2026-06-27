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
  data?: any
): void {
  if (levels[level] < levels[currentLogLevel]) return;

  const timestamp = new Date().toISOString();
  const prefix = `[${timestamp}] [${level.toUpperCase()}]`;

  if (data) {
    console.log(`${prefix} ${message}`, data);
  } else {
    console.log(`${prefix} ${message}`);
  }
}

export function debug(message: string, data?: any): void {
  log("debug", message, data);
}

export function info(message: string, data?: any): void {
  log("info", message, data);
}

export function warn(message: string, data?: any): void {
  log("warn", message, data);
}

export function error(message: string, data?: any): void {
  log("error", message, data);
}
