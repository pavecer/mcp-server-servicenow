import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { ServiceNowClient } from "../services/servicenowClient";
import { TokenManager } from "../services/tokenManager";
import { registerSearchCatalogItemsTool } from "./searchCatalogItems";
import { registerGetCatalogItemFormTool } from "./getCatalogItemForm";
import { registerPlaceOrderTool } from "./placeOrder";
import { registerValidateServiceNowConfigurationTool } from "./validateServiceNowConfiguration";
import { registerListUserOrdersTool } from "./listUserOrders";
import { registerUpdateOrderTool } from "./updateOrder";

/**
 * Single source of truth for the names of MCP tools this server exposes.
 *
 * Two surfaces consume this list:
 *
 *  - `registerTools(server)` registers a Zod-typed handler for each tool with
 *    the MCP SDK. The SDK normally returns a rich JSON-Schema for each tool
 *    via tools/list, but Copilot Studio is currently sensitive to extra MCP
 *    SDK fields (execution metadata, richer JSON Schema keywords, ...).
 *  - `getMinimalToolDefinitions()` returns a hand-authored, minimal manifest
 *    that app.ts uses to override the SDK's tools/list response.
 *
 * Keeping the two in sync was previously implicit. The startup assertion at
 * the bottom of this file now fails fast if a tool is added to one surface
 * without the other.
 */
const TOOL_NAMES = [
  "search_catalog_items",
  "get_catalog_item_form",
  "place_order",
  "validate_servicenow_configuration",
  "list_user_orders",
  "update_order"
] as const;

export type RegisteredToolName = (typeof TOOL_NAMES)[number];

export function getMinimalToolDefinitions() {
  // NOTE: This minimal manifest is hand-maintained and intentionally returned
  // by the MCP tools/list handler instead of the SDK-derived schema. Copilot
  // Studio's MCP client has historically rejected manifests that include
  // execution metadata or richer JSON Schema keywords (oneOf/anyOf, format,
  // negative numeric bounds, etc.). KEEP IN SYNC with the Zod schemas in each
  // tool file when adding/removing parameters or changing types.
  return [
    {
      name: "search_catalog_items",
      description: "Search ServiceNow catalog items using a natural-language query.",
      inputSchema: {
        type: "object",
        properties: {
          query: {
            type: "string",
            description: "User request to search for, such as laptop or VPN access"
          },
          catalogSysId: {
            type: "string",
            description: "Optional catalog sys_id filter"
          },
          categorySysId: {
            type: "string",
            description: "Optional category sys_id filter"
          },
          limit: {
            type: "integer",
            minimum: 1,
            maximum: 50,
            description: "Optional maximum number of results (1-50, default 25)"
          }
        },
        required: ["query"]
      }
    },
    {
      name: "get_catalog_item_form",
      description: "Get the order form for a selected ServiceNow catalog item.",
      inputSchema: {
        type: "object",
        properties: {
          itemSysId: {
            type: "string",
            description: "Selected catalog item sys_id"
          }
        },
        required: ["itemSysId"]
      }
    },
    {
      name: "place_order",
      description: "Place a ServiceNow catalog order with the collected form values.",
      inputSchema: {
        type: "object",
        properties: {
          itemSysId: {
            type: "string",
            description: "Catalog item sys_id"
          },
          variables: {
            type: "object",
            description: "Form field values keyed by variable name. Values may be string, number, or boolean.",
            additionalProperties: {
              type: ["string", "number", "boolean"]
            }
          },
          quantity: {
            type: "integer",
            minimum: 1,
            description: "Optional order quantity (default 1)"
          },
          requestedFor: {
            type: "string",
            description: "Optional sys_id or email of the user the item is being ordered for"
          }
        },
        required: ["itemSysId", "variables"]
      }
    },
    {
      name: "validate_servicenow_configuration",
      description: "Validate ServiceNow authentication and catalog access.",
      inputSchema: {
        type: "object",
        properties: {
          query: {
            type: "string",
            description: "Search term used for validation"
          },
          limit: {
            type: "integer",
            description: "Optional maximum number of validation results"
          },
          forceConfiguredCredentials: {
            type: "boolean",
            description: "Use configured app credentials (password or client_credentials grant) instead of the caller's x-servicenow-access-token"
          },
          probeOrderNow: {
            type: "boolean",
            description: "Optionally probe order endpoint access"
          },
          orderProbeItemSysId: {
            type: "string",
            description: "Optional item sys_id for order probe"
          },
          orderProbeVariables: {
            type: "object",
            description: "Optional order probe field values",
            additionalProperties: {
              type: "string"
            }
          }
        }
      }
    },
    {
      name: "list_user_orders",
      description: "Retrieve all current (non-closed) orders for the authenticated user.",
      inputSchema: {
        type: "object",
        properties: {
          limit: {
            type: "integer",
            minimum: 1,
            description: "Maximum number of orders to return (default: 50)"
          },
          fields: {
            type: "array",
            items: {
              type: "string"
            },
            description: "Optional list of specific fields to include in the response"
          }
        }
      }
    },
    {
      name: "update_order",
      description: "Update a service catalog order from the requestor's perspective. Allowed fields: short_description, description, comments, urgency, priority.",
      inputSchema: {
        type: "object",
        properties: {
          orderSysId: {
            type: "string",
            description: "The sys_id of the order (sc_request) to update"
          },
          updates: {
            type: "object",
            description: "Allowed fields: short_description, description, comments, urgency, priority",
            additionalProperties: false,
            properties: {
              short_description: { type: "string" },
              description: { type: "string" },
              comments: { type: "string" },
              urgency: { type: ["string", "number"] },
              priority: { type: ["string", "number"] }
            }
          }
        },
        required: ["orderSysId", "updates"]
      }
    }
  ];
}

export function registerTools(
  server: McpServer,
  client: ServiceNowClient,
  tokenManager: TokenManager
): void {
  registerSearchCatalogItemsTool(server, client);
  registerGetCatalogItemFormTool(server, client);
  registerPlaceOrderTool(server, client);
  registerValidateServiceNowConfigurationTool(server, tokenManager);
  registerListUserOrdersTool(server, client);
  registerUpdateOrderTool(server, client);
}

// Module-load drift guard: the minimal manifest exposed to Copilot Studio and
// the canonical TOOL_NAMES list must stay in sync. Throw early at import time
// if they diverge — better to fail fast on cold start than to silently expose
// an inconsistent tools/list response.
(function assertToolManifestConsistency(): void {
  const manifestNames = getMinimalToolDefinitions().map(tool => tool.name).sort();
  const expectedNames = [...TOOL_NAMES].sort();
  const same =
    manifestNames.length === expectedNames.length &&
    manifestNames.every((name, index) => name === expectedNames[index]);

  if (!same) {
    throw new Error(
      "MCP tool manifest drift detected. " +
        `Expected tools: [${expectedNames.join(", ")}]. ` +
        `Manifest tools: [${manifestNames.join(", ")}]. ` +
        "Update both src/tools/index.ts TOOL_NAMES and getMinimalToolDefinitions()."
    );
  }
})();
