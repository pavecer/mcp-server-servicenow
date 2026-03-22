import { app, HttpRequest } from "@azure/functions";
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
const handler = serverlessHttp(createMcpExpressApp(), {
  provider: "azure"
});

async function toMutableAzureRequest(request: HttpRequest): Promise<Record<string, unknown>> {
  const requestUrl = new URL(request.url);
  const headers = Object.fromEntries(request.headers.entries());
  const query = Object.fromEntries(requestUrl.searchParams.entries());

  return {
    method: request.method,
    url: requestUrl.pathname,
    requestPath: requestUrl.pathname,
    headers,
    query,
    // serverless-http azure provider expects rawBody for request creation.
    rawBody: await request.text()
  };
}

app.http("servicenow-mcp", {
  methods: ["POST"],
  authLevel: "function",
  route: "mcp",
  // Azure Functions v4 passes (request, context), while serverless-http Azure provider expects (context, req).
  handler: async (request, context) => {
    const mutableReq = await toMutableAzureRequest(request);
    return handler(context, mutableReq);
  }
});
