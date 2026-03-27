import express, { Request, Response } from "express";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { ListToolsRequestSchema } from "@modelcontextprotocol/sdk/types.js";
import { getMinimalToolDefinitions, registerTools } from "./tools/index";
import { runWithRequestContext } from "./requestContext";
import { config } from "./config";
import { validateEntraToken, buildAcceptedAudiences } from "./services/entraTokenValidator";
import { entraAuthMiddleware } from "./utils/entraAuthMiddleware";

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
  expressApp.use(async (req: Request, res: Response, next) => {
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

    // RFC 6750 / MCP OAuth spec: include WWW-Authenticate with resource_metadata
    // so MCP clients can discover the authorization server automatically.
    const resourceMetadataUrl = `${req.protocol}://${req.get("host")}/.well-known/oauth-protected-resource`;
    const authHeader = req.header("Authorization") || req.header("authorization") || "";
    if (!authHeader.startsWith("Bearer ")) {
      res
        .status(401)
        .set("WWW-Authenticate", `Bearer realm="${req.protocol}://${req.get("host")}/mcp", resource_metadata="${resourceMetadataUrl}"`)
        .json({
          error: "unauthorized",
          error_description: "A valid Entra ID Bearer token is required. Configure OAuth 2.0 in Copilot Studio to obtain one automatically."
        });
      return;
    }

    const token = authHeader.slice(7);
    const acceptedAudiences = buildAcceptedAudiences(entra.clientId, entra.audience ?? undefined, entra.allowedAudiences);

    try {
      const payload = await validateEntraToken(
        token,
        entra.tenantId,
        acceptedAudiences,
        entra.trustedTenantIds,
        entra.allowAnyTenant
      );
      res.locals.callerEntraObjectId = payload.oid;
      res.locals.callerUpn = payload.preferred_username || payload.upn;
      next();
    } catch (err) {
      const errMsg = err instanceof Error ? err.message : "unknown error";
      const isExpired = errMsg.toLowerCase().includes("expired") || errMsg.toLowerCase().includes("exp");

      // RFC 6750 §3.1: return WWW-Authenticate with error="invalid_token" so
      // OAuth clients (including Power Platform connectors) know to refresh the
      // access token automatically instead of presenting it again until it is
      // accepted.  Without this header, Power Platform treats the 401 as a
      // hard auth failure and never triggers a silent token refresh, causing
      // the connector to appear broken after inactivity.
      //
      // error="invalid_token"  → the token is expired/revoked/wrong audience;
      //                          the client SHOULD attempt a token refresh.
      // resource_metadata      → lets the connector re-discover OAuth endpoints
      //                          if its cached metadata is stale.
      const wwwAuthenticate = [
        `Bearer realm="${req.protocol}://${req.get("host")}/mcp"`,
        `resource_metadata="${resourceMetadataUrl}"`,
        `error="invalid_token"`,
        `error_description="${isExpired ? "The access token has expired" : "The access token is invalid"}`
      ].join(", ");

      res
        .status(401)
        .set("WWW-Authenticate", wwwAuthenticate)
        .json({
          error: "unauthorized",
          error_description: `Bearer token validation failed: ${errMsg}`
        });
    }
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
