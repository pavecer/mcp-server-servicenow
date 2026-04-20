import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { ServiceNowClient } from "../services/servicenowClient";
import { buildOrderFormAdaptiveCard } from "../utils/adaptiveCards";

const client = new ServiceNowClient();

export function registerGetCatalogItemFormTool(server: McpServer): void {
  const sysIdPattern = /^[0-9a-f]{32}$/i;

  server.tool(
    "get_catalog_item_form",
    [
      "Retrieve the order form for a selected ServiceNow catalog item and return it as an Adaptive Card definition.",
      "Use this tool after the user has chosen a specific catalog item from the search results.",
      "The returned Adaptive Card contains all required and optional input fields the user must fill in to place the order.",
      "Pass the sys_id from the search_catalog_items result.",
      "If you only have an item name, pass the exact item name and this tool will attempt to resolve it to a sys_id."
    ].join(" "),
    {
      itemSysId: z
        .string()
        .min(1)
        .describe(
          "The sys_id of the selected catalog item (preferred; obtained from search_catalog_items). Exact item name is also accepted as fallback."
        )
    },
    async ({ itemSysId }) => {
      let resolvedItemSysId = itemSysId.trim();

      if (!sysIdPattern.test(resolvedItemSysId)) {
        const candidateItems = await client.searchCatalogItems(resolvedItemSysId, { limit: 50 });
        const exactMatch = candidateItems.find(
          candidate => candidate.name.trim().toLowerCase() === resolvedItemSysId.toLowerCase()
        );

        if (!exactMatch) {
          const candidateNames = candidateItems.slice(0, 10).map(candidate => candidate.name);
          throw new Error(
            `Catalog item '${resolvedItemSysId}' could not be resolved to a sys_id. ` +
              `Call search_catalog_items first and pass the returned sys_id. ` +
              `Top matches: ${candidateNames.join(", ") || "none"}.`
          );
        }

        resolvedItemSysId = exactMatch.sys_id;
      }

      const item = await client.getCatalogItem(resolvedItemSysId);
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
