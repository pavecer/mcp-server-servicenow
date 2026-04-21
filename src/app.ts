import express, { Request, Response } from "express";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { ListToolsRequestSchema } from "@modelcontextprotocol/sdk/types.js";
import { getMinimalToolDefinitions, registerTools } from "./tools/index";
import { runWithRequestContext } from "./requestContext";
import { config } from "./config";
import { entraAuthMiddleware } from "./utils/entraAuthMiddleware";
import Logger from "./utils/logger";

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
  expressApp.use(express.json({ limit: "1mb", strict: true }));

  expressApp.use((_req: Request, res: Response, next) => {
    res.setHeader("X-Content-Type-Options", "nosniff");
    res.setHeader("X-Frame-Options", "DENY");
    res.setHeader("Referrer-Policy", "no-referrer");
    next();
  });

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

  // Request/response logging middleware: captures timing and errors, suppresses noisy internals
  expressApp.use((req: Request, res: Response, next) => {
    const startTime = Date.now();
    const method = req.method;
    const path = req.path;

    // Hook response finish to log after response is sent
    res.on("finish", () => {
      const durationMs = Date.now() - startTime;
      const statusCode = res.statusCode;

      if (method === "GET" && path === "/health") {
        Logger.debug("Health check", { operation: "health_check", statusCode, durationMs });
      } else if (method === "GET") {
        Logger.debug("SSE stream opened", { operation: "sse_open", statusCode, durationMs });
      } else if (method === "OPTIONS") {
        Logger.debug("CORS preflight", { operation: "cors_preflight", statusCode, durationMs });
      } else if (method === "DELETE") {
        Logger.debug("Session cleanup", { operation: "session_cleanup", statusCode, durationMs });
      } else if (method === "POST") {
        Logger.info("MCP tool call completed", { operation: "tool_call", statusCode, durationMs });
      }
    });
    next();
  });

  // ---------------------------------------------------------------------------
  // Entra ID Bearer token validation
  // ---------------------------------------------------------------------------
  // When ENTRA_TENANT_ID and ENTRA_CLIENT_ID are configured (and
  // ENTRA_AUTH_DISABLED is not true), POST requests to the MCP endpoint must
  // carry a valid Entra access token in the Authorization: Bearer header.
  // GET (SSE readiness), DELETE (session cleanup), and OPTIONS (CORS preflight)
  // are explicitly exempted — only POST carries MCP tool payloads.
  // Validated caller identity is forwarded through RequestContext so tools can
  // log or use it.  The ServiceNow service account is still used for API calls
  // unless the caller also supplies x-servicenow-access-token.
  expressApp.use((req: Request, res: Response, next) => {
    const entra = config.entraAuth;

    // Skip when Entra auth is disabled or not configured.
    if (entra.disabled || !entra.tenantId || !entra.clientId) {
      next();
      return;
    }

    // Only enforce Bearer token auth on POST requests (MCP tool calls).
    // GET, DELETE, and OPTIONS are used for SSE, session management, and CORS
    // and must remain accessible without a token.
    if (req.method !== "POST") {
      next();
      return;
    }
    entraAuthMiddleware(req, res, next);
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
  // Use app.use as Express 5-compatible route handler.
  expressApp.use(async (req: Request, res: Response): Promise<void> => {
    if (req.path !== "/mcp") {
      res.status(404).json({ error: "not_found" });
      return;
    }

    if (req.method === "POST" && !req.is("application/json")) {
      res.status(415).json({ error: "unsupported_media_type" });
      return;
    }

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
      const callerEntraObjectId = (res.locals.callerEntraObjectId as string | undefined);
      const callerUpn = (res.locals.callerUpn as string | undefined);

      await runWithRequestContext(
        {
          serviceNowAccessToken,
          callerEntraObjectId,
          callerUpn
        },
        async () => {
          normalizeAcceptHeader(req);
          ensureRawHeaders(req);
          await transport.handleRequest(req, res, req.body);
        }
      );

      res.on("finish", () => {
        transport.close().catch((error: unknown) => {
          Logger.warn("Failed to close MCP transport", { operation: "transport.close_failed" }, error);
        });
        server.close().catch((error: unknown) => {
          Logger.warn("Failed to close MCP server", { operation: "server.close_failed" }, error);
        });
      });
    } catch (err) {
      Logger.error("MCP request handling error", { operation: "mcp.request_failed" }, err);
      if (!res.headersSent) {
        res.status(500).json({ error: "internal_server_error" });
      }
    }
  });

  return expressApp;
}
