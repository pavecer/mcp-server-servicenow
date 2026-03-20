import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { ServiceNowClient } from "../services/servicenowClient";
import { buildOrderConfirmationAdaptiveCard } from "../utils/adaptiveCards";
import { config } from "../config";

const client = new ServiceNowClient();

export function registerPlaceOrderTool(server: McpServer): void {
  server.tool(
    "place_order",
    [
      "Submit an order for a ServiceNow catalog item using the field values collected from the user.",
      "Use this tool after the user has filled in all required fields from the get_catalog_item_form result.",
      "Returns an Adaptive Card with the order confirmation, including the request number, status, and a direct link to the request in ServiceNow."
    ].join(" "),
    {
      itemSysId: z
        .string()
        .min(1)
        .describe("The sys_id of the catalog item to order (from search_catalog_items or get_catalog_item_form)"),
      variables: z
        .record(z.string(), z.union([z.string(), z.number(), z.boolean()]))
        .describe(
          "Key-value pairs mapping each form field name (variable.name) to the value provided by the user"
        ),
      quantity: z
        .number()
        .int()
        .positive()
        .optional()
        .default(1)
        .describe("Quantity to order (default: 1)"),
      requestedFor: z
        .string()
        .optional()
        .describe(
          "Optional sys_id or email address of the user the item is being ordered for (defaults to the authenticated user)"
        )
    },
    async ({ itemSysId, variables, quantity, requestedFor }) => {
      const result = await client.placeOrder(itemSysId, {
        variables,
        quantity,
        requestedFor
      });

      const adaptiveCard = buildOrderConfirmationAdaptiveCard(
        result,
        config.serviceNow.instanceUrl
      );

      return {
        content: [
          {
            type: "text" as const,
            text: JSON.stringify({
              success: true,
              requestNumber: result.request_number,
              requestId: result.request_id ?? null,
              adaptiveCard
            }, null, 2)
          }
        ]
      };
    }
  );
}
