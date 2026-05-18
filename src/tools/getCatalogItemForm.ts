import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { ServiceNowClient } from "../services/servicenowClient";
import { buildOrderFormAdaptiveCard } from "../utils/adaptiveCards";
import { computePrefillValues } from "../utils/prefillCatalogForm";

export function registerGetCatalogItemFormTool(server: McpServer, client: ServiceNowClient): void {
  const sysIdPattern = /^[0-9a-f]{32}$/i;

  server.tool(
    "get_catalog_item_form",
    [
      "Retrieve the order form for a selected ServiceNow catalog item and return it as an Adaptive Card definition.",
      "Use this tool after the user has chosen a specific catalog item from the search results.",
      "The returned Adaptive Card contains all required and optional input fields the user must fill in to place the order.",
      "Pass the sys_id from the search_catalog_items result.",
      "If you only have an item name, pass the exact item name and this tool will attempt to resolve it to a sys_id.",
      "SMART PREFILL: Pass `prefillHints` with any field values you have already extracted from the conversation,",
      "for example { color: 'black', storage: '256GB', carrier: 'Verizon', justification: 'Replacement for damaged device' }.",
      "Hint keys can be either the ServiceNow variable name or a normalized label keyword (color, storage, carrier, model, justification, quantity, date, location).",
      "The tool normalizes hint values against the actual catalog choice list so the rendered Adaptive Card is pre-populated for the user to review.",
      "You can also pass `userContext` (a short free-text summary of the relevant conversation) as a fallback - the tool will extract common patterns from it.",
      "The response includes `prefilledValues` and `prefillDiagnostics` so you can see what was filled and why."
    ].join(" "),
    {
      itemSysId: z
        .string()
        .min(1)
        .describe(
          "The sys_id of the selected catalog item (preferred; obtained from search_catalog_items). Exact item name is also accepted as fallback."
        ),
      userContext: z
        .string()
        .optional()
        .describe(
          "Optional free-text summary of the relevant conversation (e.g. 'User wants a black iPhone with 256GB on Verizon, needed by 2026-06-01'). Used as a fallback for prefilling fields when no structured hint is provided."
        ),
      prefillHints: z
        .record(z.string(), z.union([z.string(), z.number(), z.boolean()]))
        .optional()
        .describe(
          "Optional structured key/value pairs extracted from the conversation. Keys may be the ServiceNow variable name OR a normalized label keyword (e.g. 'color', 'storage', 'carrier', 'model', 'justification', 'quantity'). Values are normalized against the catalog item's actual choice list."
        )
    },
    async ({ itemSysId, userContext, prefillHints }) => {
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

      const { values: prefilledValues, diagnostics: prefillDiagnostics } = computePrefillValues(
        item.variables,
        { userContext, prefillHints }
      );

      const adaptiveCard = buildOrderFormAdaptiveCard(item, prefilledValues);

      return {
        content: [
          {
            type: "text" as const,
            text: JSON.stringify({
              itemSysId: item.sys_id,
              itemName: item.name,
              variableCount: item.variables?.length ?? 0,
              prefilledValues,
              prefillDiagnostics,
              adaptiveCard
            }, null, 2)
          }
        ]
      };
    }
  );
}
