import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { ServiceNowClient } from "../services/servicenowClient";

const client = new ServiceNowClient();

export function registerListUserOrdersTool(server: McpServer): void {
  server.tool(
    "list_user_orders",
    [
      "Retrieve all current (non-closed) orders for the authenticated user.",
      "Lists service catalog orders that are not in a closed/resolved state.",
      "Returns order details including order number, status, description, and assignment information."
    ].join(" "),
    {
      limit: z
        .number()
        .int()
        .positive()
        .optional()
        .default(50)
        .describe("Maximum number of orders to return (default: 50)"),
      fields: z
        .array(z.string())
        .optional()
        .describe(
          "Optional list of specific fields to include in the response. If not provided, returns: sys_id, number, short_description, description, state, assignment_group, assigned_to, created_on, updated_on, request_status"
        )
    },
    async ({ limit, fields }) => {
      try {
        const orders = await client.listUserOrders(limit, fields);

        if (orders.length === 0) {
          return {
            content: [
              {
                type: "text" as const,
                text: JSON.stringify({
                  success: true,
                  message: "No open orders found for the current user",
                  orders: [],
                  count: 0
                }, null, 2)
              }
            ]
          };
        }

        return {
          content: [
            {
              type: "text" as const,
              text: JSON.stringify({
                success: true,
                count: orders.length,
                orders: orders
              }, null, 2)
            }
          ]
        };
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : String(error);
        return {
          content: [
            {
              type: "text" as const,
              text: JSON.stringify({
                success: false,
                error: errorMessage,
                message: "Failed to retrieve user orders"
              }, null, 2)
            }
          ]
        };
      }
    }
  );
}
