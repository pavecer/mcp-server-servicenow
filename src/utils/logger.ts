import { getRequestContext } from "../requestContext";

export type LogLevel = "debug" | "info" | "warn" | "error";

interface LogEntry {
  timestamp: string;
  level: LogLevel;
  message: string;
  context?: {
    callerObjectId?: string;
    callerUpn?: string;
    operation?: string;
    [key: string]: unknown;
  };
  error?: {
    message: string;
    stack?: string;
    httpStatus?: number;
  };
}

/**
 * Structured logger for the MCP server.
 * Logs are sent to console which Azure Functions captures in Application Insights.
 * Include minimal context to avoid excessive log volume in App Insights.
 */
export class Logger {
  private static readonly MIN_LOG_LEVEL: LogLevel = (process.env.LOG_LEVEL as LogLevel) || "info";
  private static readonly LOG_LEVELS: Record<LogLevel, number> = {
    debug: 0,
    info: 1,
    warn: 2,
    error: 3
  };

  private static shouldLog(level: LogLevel): boolean {
    return Logger.LOG_LEVELS[level] >= Logger.LOG_LEVELS[Logger.MIN_LOG_LEVEL];
  }

  private static formatLog(entry: LogEntry): string {
    // Format: [LEVEL] timestamp | message | context
    // Compact JSON-compatible format suitable for App Insights parsing
    const contextStr = entry.context
      ? Object.entries(entry.context)
          .filter(([, v]) => v !== undefined && v !== null)
          .map(([k, v]) => `${k}=${typeof v === "string" ? v : JSON.stringify(v)}`)
          .join("|")
      : "";

    const errorStr = entry.error ? `err=${entry.error.message}` : "";
    const parts = [entry.message, contextStr, errorStr].filter(Boolean).join("|");

    return `[${entry.level.toUpperCase()}] ${entry.timestamp} | ${parts}`;
  }

  private static log(level: LogLevel, message: string, context?: Record<string, unknown>, error?: unknown): void {
    if (!Logger.shouldLog(level)) {
      return;
    }

    const requestCtx = getRequestContext();
    const entry: LogEntry = {
      timestamp: new Date().toISOString(),
      level,
      message,
      context: {
        callerObjectId: requestCtx?.callerEntraObjectId,
        callerUpn: requestCtx?.callerUpn,
        ...context
      }
    };

    if (error) {
      if (error instanceof Error) {
        entry.error = {
          message: error.message,
          stack: error.stack
        };
        // Extract httpStatus if present
        if ("httpStatus" in error && typeof (error as Record<string, unknown>).httpStatus === "number") {
          entry.error.httpStatus = (error as Record<string, unknown>).httpStatus as number;
        }
      } else {
        entry.error = {
          message: String(error)
        };
      }
    }

    const formatted = Logger.formatLog(entry);
    if (level === "error") {
      console.error(formatted);
    } else if (level === "warn") {
      console.warn(formatted);
    } else {
      console.log(formatted);
    }
  }

  static debug(message: string, context?: Record<string, unknown>): void {
    Logger.log("debug", message, context);
  }

  static info(message: string, context?: Record<string, unknown>): void {
    Logger.log("info", message, context);
  }

  static warn(message: string, context?: Record<string, unknown>, error?: unknown): void {
    Logger.log("warn", message, context, error);
  }

  static error(message: string, context?: Record<string, unknown>, error?: unknown): void {
    Logger.log("error", message, context, error);
  }
}

export default Logger;
