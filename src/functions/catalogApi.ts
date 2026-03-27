import { app, HttpRequest, HttpResponseInit, InvocationContext } from "@azure/functions";
import express, { Request, Response } from "express";
import serverlessHttp from "serverless-http";
import { ServiceNowClient } from "../services/servicenowClient";
import { buildCatalogItemSelectionAdaptiveCard, buildOrderFormAdaptiveCard, buildOrderConfirmationAdaptiveCard } from "../utils/adaptiveCards";
import { entraAuthMiddleware } from "../utils/entraAuthMiddleware";
import { runWithRequestContext } from "../requestContext";
import { config } from "../config";

/**
 * Catalog REST API — deterministic endpoints for Copilot Studio topic-driven flows.
 *
 * These endpoints complement the MCP server (/mcp) which is used for AI-orchestrated
 * (generative) tool calling. Use these endpoints when:
 *
 *   - A Copilot Studio topic needs to drive the ordering flow deterministically
 *   - The topic needs to render Adaptive Cards natively (card JSON is returned
 *     in a structured field so the topic can send it as a card attachment activity)
 *   - You need predictable, step-by-step dialog control over search → form → order
 *
 * Endpoints:
 *   POST /api/catalog/search        Search catalog items
 *   GET  /api/catalog/form/:sysId   Get order form + Adaptive Card for an item
 *   POST /api/catalog/order         Place a catalog order
 *
 * Auth: same Entra Bearer token as the MCP endpoint.
 * The caller must have a valid token with aud=api://<ENTRA_CLIENT_ID>.
 *
 * Copilot Studio Custom Connector:
 * Register these endpoints as operations in your Power Platform custom connector
 * using the OpenAPI spec at docs/CATALOG_REST_API.openapi.json.
 * Once registered, use InvokeConnectorAction in topics to call them.
 */

const catalogClient = new ServiceNowClient();

const CORS_HEADERS: Record<string, string> = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, x-functions-key"
};

// ---------------------------------------------------------------------------
// Express app hosting the catalog REST routes
// ---------------------------------------------------------------------------

function createCatalogExpressApp(): express.Express {
  const apiApp = express();
  apiApp.use(express.json());

  // Apply Entra auth to all routes (middleware handles disabled/unconfigured case).
  apiApp.use(entraAuthMiddleware);

  // ── Search catalog items ───────────────────────────────────────────────────
  // POST /api/catalog/search
  // Body: { query: string, limit?: number, catalogSysId?: string, categorySysId?: string }
  //
  // Response: {
  //   found: number,
  //   items: [ { sysId, name, shortDescription, category, categoryId, catalog, catalogId } ],
  //   selectionAdaptiveCard: { ... }  ← send as adaptive card attachment in topic
  // }
  apiApp.post("/api/catalog/search", async (req: Request, res: Response) => {
    const { query, limit, catalogSysId, categorySysId } = req.body ?? {};

    if (!query || typeof query !== "string" || query.trim() === "") {
      res.status(400).json({ error: "bad_request", error_description: "query is required" });
      return;
    }

    try {
      const serviceNowAccessToken = req.header("x-servicenow-access-token") || undefined;
      const items = await runWithRequestContext({ serviceNowAccessToken }, () =>
        catalogClient.searchCatalogItems(query.trim(), {
          limit: typeof limit === "number" ? limit : 10,
          catalogSysId: typeof catalogSysId === "string" ? catalogSysId : undefined,
          categorySysId: typeof categorySysId === "string" ? categorySysId : undefined
        })
      );

      const selectionAdaptiveCard = items.length > 0
        ? buildCatalogItemSelectionAdaptiveCard(items)
        : null;

      res.set("Content-Type", "application/json").json({
        found: items.length,
        items: items.map(item => ({
          sysId: item.sys_id,
          name: item.name,
          shortDescription: item.short_description ?? null,
          category: item.category?.title ?? item.category?.name ?? null,
          categoryId: item.category?.sys_id ?? null,
          catalog: item.sc_catalog?.title ?? item.sc_catalog?.name ?? null,
          catalogId: item.sc_catalog?.sys_id ?? null
        })),
        // Adaptive Card JSON — send this as application/vnd.microsoft.card.adaptive
        // in a SendActivity step in your Copilot Studio topic.
        selectionAdaptiveCard
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Unknown error";
      res.status(502).json({ error: "upstream_error", error_description: msg });
    }
  });

  // ── Get order form ─────────────────────────────────────────────────────────
  // GET /api/catalog/form/:sysId
  //
  // Response: {
  //   sysId: string,
  //   name: string,
  //   variableCount: number,
  //   variables: [ { name, label, type, mandatory, defaultValue } ],
  //   formAdaptiveCard: { ... }  ← send as adaptive card attachment in topic
  // }
  apiApp.get("/api/catalog/form/:sysId", async (req: Request, res: Response) => {
    const sysId = Array.isArray(req.params.sysId) ? req.params.sysId[0] : req.params.sysId;

    if (!sysId || sysId.trim() === "") {
      res.status(400).json({ error: "bad_request", error_description: "sysId is required" });
      return;
    }

    try {
      const serviceNowAccessToken = req.header("x-servicenow-access-token") || undefined;
      const item = await runWithRequestContext({ serviceNowAccessToken }, () =>
        catalogClient.getCatalogItem(sysId as string)
      );

      const formAdaptiveCard = buildOrderFormAdaptiveCard(item);

      res.set("Content-Type", "application/json").json({
        sysId: item.sys_id,
        name: item.name,
        shortDescription: item.short_description ?? null,
        variableCount: item.variables?.length ?? 0,
        // Simplified variable list for easy Power Fx parsing in topics.
        variables: (item.variables ?? []).map(v => ({
          name: v.name,
          label: v.label ?? v.name,
          type: v.type ?? "string",
          mandatory: v.mandatory === true,
          defaultValue: v.default_value ?? null
        })),
        // Adaptive Card JSON — send this as application/vnd.microsoft.card.adaptive
        // in a SendActivity step in your Copilot Studio topic.
        formAdaptiveCard
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Unknown error";
      res.status(502).json({ error: "upstream_error", error_description: msg });
    }
  });

  // ── Place order ───────────────────────────────────────────────────────────
  // POST /api/catalog/order
  // Body: {
  //   itemSysId: string,
  //   variables: Record<string, string>,
  //   quantity?: number,
  //   requestedFor?: string
  // }
  //
  // Response: {
  //   success: true,
  //   requestNumber: string,
  //   requestId: string | null,
  //   confirmationAdaptiveCard: { ... }  ← send as adaptive card attachment in topic
  // }
  apiApp.post("/api/catalog/order", async (req: Request, res: Response) => {
    const { itemSysId, variables, quantity, requestedFor } = req.body ?? {};

    if (!itemSysId || typeof itemSysId !== "string") {
      res.status(400).json({ error: "bad_request", error_description: "itemSysId is required" });
      return;
    }

    if (!variables || typeof variables !== "object" || Array.isArray(variables)) {
      res.status(400).json({ error: "bad_request", error_description: "variables must be an object" });
      return;
    }

    try {
      const serviceNowAccessToken = req.header("x-servicenow-access-token") || undefined;
      const result = await runWithRequestContext({ serviceNowAccessToken }, () =>
        catalogClient.placeOrder(itemSysId, {
          variables,
          quantity: typeof quantity === "number" ? quantity : 1,
          requestedFor: typeof requestedFor === "string" ? requestedFor : undefined
        })
      );

      const confirmationAdaptiveCard = buildOrderConfirmationAdaptiveCard(
        result,
        config.serviceNow.instanceUrl
      );

      res.status(201).set("Content-Type", "application/json").json({
        success: true,
        requestNumber: result.request_number,
        requestId: result.request_id ?? null,
        // Adaptive Card JSON — send as application/vnd.microsoft.card.adaptive.
        confirmationAdaptiveCard
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Unknown error";
      res.status(502).json({ error: "upstream_error", error_description: msg });
    }
  });

  return apiApp;
}

// ---------------------------------------------------------------------------
// Azure Function wrappers
// ---------------------------------------------------------------------------

const catalogHandler = serverlessHttp(createCatalogExpressApp(), { provider: "azure" });

async function toAzureRequest(request: HttpRequest): Promise<Record<string, unknown>> {
  const requestUrl = new URL(request.url);
  return {
    method: request.method,
    url: requestUrl.pathname,
    requestPath: requestUrl.pathname,
    headers: Object.fromEntries(request.headers.entries()),
    query: Object.fromEntries(requestUrl.searchParams.entries()),
    rawBody: await request.text()
  };
}

async function catalogFunctionHandler(
  request: HttpRequest,
  context: InvocationContext
): Promise<HttpResponseInit> {
  const mutableReq = await toAzureRequest(request);
  const result = await catalogHandler(context, mutableReq) as HttpResponseInit;
  return { ...result, headers: { ...CORS_HEADERS, ...(result.headers ?? {}) } };
}

// POST /api/catalog/search
app.http("catalog-search", {
  methods: ["POST"],
  authLevel: "anonymous",
  route: "api/catalog/search",
  handler: catalogFunctionHandler
});

// GET /api/catalog/form/{sysId}
app.http("catalog-form", {
  methods: ["GET"],
  authLevel: "anonymous",
  route: "api/catalog/form/{sysId}",
  handler: catalogFunctionHandler
});

// POST /api/catalog/order
app.http("catalog-order", {
  methods: ["POST"],
  authLevel: "anonymous",
  route: "api/catalog/order",
  handler: catalogFunctionHandler
});

// CORS preflight for all catalog routes
app.http("catalog-options", {
  methods: ["OPTIONS"],
  authLevel: "anonymous",
  route: "api/catalog/{*rest}",
  handler: async (): Promise<HttpResponseInit> => ({ status: 204, headers: CORS_HEADERS })
});
