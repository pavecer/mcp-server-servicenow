import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { registerSearchCatalogItemsTool } from "./searchCatalogItems";
import { registerGetCatalogItemFormTool } from "./getCatalogItemForm";
import { registerPlaceOrderTool } from "./placeOrder";
import { registerValidateServiceNowConfigurationTool } from "./validateServiceNowConfiguration";
import { registerListUserOrdersTool } from "./listUserOrders";
import { registerUpdateOrderTool } from "./updateOrder";

export function getMinimalToolDefinitions() {
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
            description: "Optional maximum number of results"
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
            description: "Form field values keyed by variable name",
            additionalProperties: {
              type: "string"
            }
          },
          quantity: {
            type: "integer",
            description: "Optional order quantity"
          },
          requestedFor: {
            type: "string",
            description: "Optional requested-for user"
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
          forceClientCredentials: {
            type: "boolean",
            description: "Use configured client credentials instead of caller token"
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
      description: "Update a service catalog order from the requestor's perspective.",
      inputSchema: {
        type: "object",
        properties: {
          orderSysId: {
            type: "string",
            description: "The sys_id of the order (sc_request) to update"
          },
          updates: {
            type: "object",
            description: "Key-value pairs of fields to update",
            additionalProperties: true
          }
        },
        required: ["orderSysId", "updates"]
      }
    }
  ];
}

export function registerTools(server: McpServer): void {
  registerSearchCatalogItemsTool(server);
  registerGetCatalogItemFormTool(server);
  registerPlaceOrderTool(server);
  registerValidateServiceNowConfigurationTool(server);
  registerListUserOrdersTool(server);
  registerUpdateOrderTool(server);
}
