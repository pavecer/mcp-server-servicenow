import { app } from "@azure/functions";
import serverlessHttp from "serverless-http";
import { createMcpExpressApp } from "../app";

/**
 * Azure Functions v4 HTTP trigger that hosts the ServiceNow MCP server.
 *
 * The MCP endpoint is accessible at:
 *   https://<function-app>.azurewebsites.net/mcp
 *
 * Authentication: Azure Function key passed via header `x-functions-key`
 * or query parameter `code`.
 *
 */
const handler = serverlessHttp(createMcpExpressApp());

app.http("servicenow-mcp", {
  methods: ["POST"],
  authLevel: "function",
  route: "mcp",
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  handler: handler as any
});
