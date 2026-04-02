import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { ServiceNowClient } from "../services/servicenowClient";

const client = new ServiceNowClient();

export function registerUpdateOrderTool(server: McpServer): void {
  server.tool(
    "update_order",
    [
      "Update a service catalog order from the requestor's perspective.",
      "Allows the end user (requestor) to update fields in their order such as description, priority, or other mutable fields.",
      "The order is updated directly in ServiceNow and returns the updated order details."
    ].join(" "),
    {
      orderSysId: z
        .string()
        .min(1)
        .describe("The sys_id of the order (sc_request) to update. Can be obtained from list_user_orders or the order confirmation."),
      updates: z
        .record(z.string(), z.union([z.string(), z.number(), z.boolean(), z.null()]))
        .describe(
          "Key-value pairs of fields to update. Common fields include: short_description, description, comments, priority, urgency. Field names should be the ServiceNow table field names."
        )
    },
    async ({ orderSysId, updates }) => {
      try {
        // Validate that at least one field is being updated
        if (!updates || Object.keys(updates).length === 0) {
          return {
            content: [
              {
                type: "text" as const,
                text: JSON.stringify({
                  success: false,
                  error: "No fields provided for update",
                  message: "Please specify at least one field to update"
                }, null, 2)
              }
            ]
          };
        }

        const updatedOrder = await client.updateOrder(orderSysId, updates);

        return {
          content: [
            {
              type: "text" as const,
              text: JSON.stringify({
                success: true,
                message: "Order updated successfully",
                updatedFields: Object.keys(updates),
                updatedOrder: updatedOrder
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
                message: "Failed to update order",
                orderSysId: orderSysId
              }, null, 2)
            }
          ]
        };
      }
    }
  );
}
