import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { ServiceNowClient } from "../services/servicenowClient";
import { buildOrderFormAdaptiveCard } from "../utils/adaptiveCards";

const client = new ServiceNowClient();

export function registerGetCatalogItemFormTool(server: McpServer): void {
  server.tool(
    "get_catalog_item_form",
    [
      "Retrieve the order form for a selected ServiceNow catalog item and return it as an Adaptive Card definition.",
      "Use this tool after the user has chosen a specific catalog item from the search results.",
      "The returned Adaptive Card contains all required and optional input fields the user must fill in to place the order.",
      "Pass the sys_id from the search_catalog_items result."
    ].join(" "),
    {
      itemSysId: z
        .string()
        .min(1)
        .describe("The sys_id of the selected catalog item (obtained from search_catalog_items)")
    },
    async ({ itemSysId }) => {
      const item = await client.getCatalogItem(itemSysId);
      const adaptiveCard = buildOrderFormAdaptiveCard(item);

      return {
        content: [
          {
            type: "text" as const,
            text: JSON.stringify({
              itemSysId: item.sys_id,
              itemName: item.name,
              variableCount: item.variables?.length ?? 0,
              adaptiveCard
            }, null, 2)
          }
        ]
      };
    }
  );
}
