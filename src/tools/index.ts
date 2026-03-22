import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { registerSearchCatalogItemsTool } from "./searchCatalogItems";
import { registerGetCatalogItemFormTool } from "./getCatalogItemForm";
import { registerPlaceOrderTool } from "./placeOrder";
import { registerValidateServiceNowConfigurationTool } from "./validateServiceNowConfiguration";

export function registerTools(server: McpServer): void {
  registerSearchCatalogItemsTool(server);
  registerGetCatalogItemFormTool(server);
  registerPlaceOrderTool(server);
  registerValidateServiceNowConfigurationTool(server);
}
