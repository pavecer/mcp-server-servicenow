import express, { Request, Response } from "express";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { ListToolsRequestSchema } from "@modelcontextprotocol/sdk/types.js";
import { getMinimalToolDefinitions, registerTools } from "./tools/index";
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

  const setMcpHttpHeaders = (res: Response): void => {
    res.setHeader("Allow", "GET, POST, DELETE, OPTIONS");
    res.setHeader("Access-Control-Allow-Methods", "GET, POST, DELETE, OPTIONS");
    res.setHeader(
      "Access-Control-Allow-Headers",
      "accept, content-type, mcp-protocol-version, mcp-session-id, last-event-id, authorization, x-functions-key"
    );
    res.setHeader("Access-Control-Expose-Headers", "mcp-session-id");
  };

  const normalizeAcceptHeader = (req: Request): void => {
    const current = req.headers.accept;
    const normalized = Array.isArray(current) ? current.join(",") : (current || "");
    const acceptsJson = normalized.includes("application/json") || normalized.includes("*/*");
    const acceptsSse = normalized.includes("text/event-stream") || normalized.includes("*/*");

    if (!acceptsJson || !acceptsSse) {
      (req.headers as Record<string, string | string[] | undefined>).accept = "application/json, text/event-stream";
    }
  };

  const ensureRawHeaders = (req: Request): void => {
    const pairs: string[] = [];
    for (const [key, value] of Object.entries(req.headers)) {
      if (Array.isArray(value)) {
        for (const entry of value) {
          pairs.push(key, String(entry));
        }
      } else if (typeof value !== "undefined") {
        pairs.push(key, String(value));
      }
    }

    (req as unknown as { rawHeaders?: string[] }).rawHeaders = pairs;
  };

  // Health / readiness probe used by Azure to verify the function is up
  expressApp.get("/health", (_req: Request, res: Response) => {
    res.json({ status: "ok", server: "servicenow-mcp" });
  });

  expressApp.use((req: Request, res: Response, next) => {
    setMcpHttpHeaders(res);

    if (req.method === "OPTIONS") {
      res.status(204).end();
      return;
    }

    if (req.method === "GET") {
      res.setHeader("Content-Type", "text/event-stream");
      res.status(200).send(": mcp endpoint ready\n\n");
      return;
    }

    if (req.method === "DELETE") {
      res.status(204).end();
      return;
    }

    next();
  });

    // Serve MCP over Streamable HTTP transport (stateless mode)
    // Use app.use as Express 5-compatible catch-all route.
    expressApp.use(async (req: Request, res: Response): Promise<void> => {
    const server = new McpServer({
      name: "servicenow-mcp",
      version: "1.0.0"
    });

    registerTools(server);

    // Copilot Studio currently appears sensitive to extra MCP SDK fields such as
    // execution metadata and some richer JSON Schema keywords. Override tools/list
    // with a minimal manifest while leaving tool execution on the SDK path.
    server.server.setRequestHandler(ListToolsRequestSchema, () => ({
      tools: getMinimalToolDefinitions()
    }));

    const transport = new StreamableHTTPServerTransport({
      // stateless mode: no session affinity required
      sessionIdGenerator: undefined,
      // Some clients fail to parse SSE-wrapped JSON-RPC responses during discovery.
      // Force JSON responses for compatibility while keeping Streamable HTTP semantics.
      enableJsonResponse: true
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
          normalizeAcceptHeader(req);
          ensureRawHeaders(req);
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
