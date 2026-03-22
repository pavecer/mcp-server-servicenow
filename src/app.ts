import express, { Request, Response } from "express";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { registerTools } from "./tools/index";
import { runWithRequestContext } from "./requestContext";

/**
 * Creates and returns the Express application that hosts the MCP server.
 *
 * The MCP endpoint is exposed at any path (wildcard) to remain compatible with
 * both Azure Functions routing and local development. The transport is configured
 * in stateless mode (sessionIdGenerator = undefined) so each request is handled
 * independently — required for serverless/Azure Functions deployment.
 */
export function createMcpExpressApp(): express.Express {
  const expressApp = express();
  expressApp.use(express.json());

  // Health / readiness probe used by Azure to verify the function is up
  expressApp.get("/health", (_req: Request, res: Response) => {
    res.json({ status: "ok", server: "servicenow-mcp" });
  });

    // Serve MCP over Streamable HTTP transport (stateless mode)
    // Use app.use as Express 5-compatible catch-all route.
    expressApp.use(async (req: Request, res: Response): Promise<void> => {
    const server = new McpServer({
      name: "servicenow-mcp",
      version: "1.0.0"
    });

    registerTools(server);

    const transport = new StreamableHTTPServerTransport({
      // stateless mode: no session affinity required
      sessionIdGenerator: undefined
    });

    try {
      await server.connect(transport);
      // Pass the parsed JSON body so the transport doesn't need to re-read the stream
      const serviceNowAccessToken = req.header("x-servicenow-access-token") || undefined;

      await runWithRequestContext(
        {
          serviceNowAccessToken
        },
        async () => {
          await transport.handleRequest(req, res, req.body);
        }
      );

      res.on("finish", () => {
        transport.close().catch(console.error);
        server.close().catch(console.error);
      });
    } catch (err) {
      console.error("[MCP] request handling error:", err);
      if (!res.headersSent) {
        res.status(500).json({ error: "internal_server_error" });
      }
    }
  });

  return expressApp;
}
