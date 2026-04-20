import type { Server } from "node:http";
import { createMcpExpressApp } from "./app";

const rawPort = process.env.PORT || "8080";
const port = Number.parseInt(rawPort, 10);

if (!Number.isFinite(port) || port <= 0) {
  throw new Error(`Invalid PORT value: ${rawPort}`);
}

const app = createMcpExpressApp();

const server: Server = app.listen(port, () => {
  console.log(`[MCP] Standalone server listening on port ${port}`);
  console.log(`[MCP] Health endpoint: /health`);
  console.log(`[MCP] MCP endpoint: /mcp`);
});

const shutdown = (signal: string) => {
  console.log(`[MCP] Received ${signal}. Shutting down.`);
  server.close((error?: Error) => {
    if (error) {
      console.error("[MCP] Shutdown error:", error);
      process.exitCode = 1;
    }
    process.exit();
  });
};

process.on("SIGINT", () => shutdown("SIGINT"));
process.on("SIGTERM", () => shutdown("SIGTERM"));
