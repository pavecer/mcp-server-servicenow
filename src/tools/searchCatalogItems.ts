import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { serviceNowClient as client } from "../services/servicenowClient";
import { buildCatalogItemSelectionAdaptiveCard } from "../utils/adaptiveCards";

export function registerSearchCatalogItemsTool(server: McpServer): void {
  server.tool(
    "search_catalog_items",
    [
      "Search the ServiceNow Service Catalog for items matching the user's intent.",
      "Accepts natural language text derived from the conversation and returns a ranked list of matching catalog items.",
      "When header x-servicenow-access-token is provided, results are returned based on that ServiceNow user's access permissions.",
      "Use this tool first to help the user discover and select available service catalog items.",
      "Results include each item's sys_id (required for subsequent tools), name, short description, category, catalog,",
      "categorySysId, and catalogSysId (use these to restrict follow-up searches to the same category or catalog).",
      "An Adaptive Card (selectionAdaptiveCard) is also returned so the user can select their preferred item directly."
    ].join(" "),
    {
      query: z
        .string()
        .min(1)
        .describe(
          "The search text representing the user's intent or request (e.g. 'new laptop', 'VPN access', 'reset my password')"
        ),
      catalogSysId: z
        .string()
        .optional()
        .describe("Optional sys_id of a specific catalog to restrict the search"),
      categorySysId: z
        .string()
        .optional()
        .describe("Optional sys_id of a specific category to filter results"),
      limit: z
        .number()
        .int()
        .positive()
        .max(50)
        .optional()
        .default(10)
        .describe("Maximum number of results to return (default: 10, max: 50)")
    },
    async ({ query, catalogSysId, categorySysId, limit }) => {
      const items = await client.searchCatalogItems(query, {
        catalogSysId,
        categorySysId,
        limit
      });

      if (items.length === 0) {
        return {
          content: [
            {
              type: "text" as const,
              text: JSON.stringify({
                found: 0,
                items: [],
                message: "No catalog items found matching the query. Try different keywords."
              }, null, 2)
            }
          ]
        };
      }

      const selectionAdaptiveCard = buildCatalogItemSelectionAdaptiveCard(items);

      return {
        content: [
          {
            type: "text" as const,
            text: JSON.stringify({
              found: items.length,
              items: items.map(item => ({
                sys_id: item.sys_id,
                name: item.name,
                short_description: item.short_description ?? null,
                category: item.category?.title ?? item.category?.name ?? null,
                categorySysId: item.category?.sys_id ?? null,
                catalog: item.sc_catalog?.title ?? item.sc_catalog?.name ?? null,
                catalogSysId: item.sc_catalog?.sys_id ?? null
              })),
              selectionAdaptiveCard
            }, null, 2)
          }
        ]
      };
    }
  );
}
