# ServiceNow MCP Server (Azure Functions)

This project hosts a stateless MCP server for ServiceNow on Azure Functions.

It provides three MCP tools:

- `search_catalog_items`: Search ServiceNow catalog items by free text intent (with optional category/catalog filtering).
- `get_catalog_item_form`: Retrieve an item's variables and return an Adaptive Card form definition.
- `place_order`: Place an order and return an Adaptive Card confirmation (request number, status, link).

## Architecture

- Runtime: Azure Functions v4 (Node.js 20, Flex Consumption FC1)
- MCP transport: Streamable HTTP in stateless mode
- ServiceNow auth: OAuth 2.0 client credentials
- Secrets: ServiceNow client secret stored in Azure Key Vault and referenced by Function App app settings

## Prerequisites

- Node.js 20+
- npm
- Azure Functions Core Tools v4
- Azure Developer CLI (`azd`)
- Azure CLI (`az`)
- A ServiceNow OAuth application with:
  - `client_id`
  - `client_secret`
  - token endpoint available at `/oauth_token.do` (or custom path)

## Local Development

1. Install dependencies:

```bash
npm install
```

2. Build:

```bash
npm run build
```

3. Create local settings file from sample and set values:

- `SERVICENOW_INSTANCE_URL`
- `SERVICENOW_CLIENT_ID`
- `SERVICENOW_CLIENT_SECRET`
- Optional: `SERVICENOW_DEFAULT_CATALOG`, `SERVICENOW_DEFAULT_CATEGORY`

4. Run locally:

```bash
npm run start:dev
```

The MCP endpoint will be available at:

- `http://localhost:7071/mcp`

## Deploy to Azure

1. Authenticate:

```bash
az login
azd auth login
```

2. Initialize environment (first time only):

```bash
azd env new <environment-name>
```

3. Set required environment values:

```bash
azd env set SERVICENOW_INSTANCE_URL "https://<your-instance>.service-now.com"
azd env set SERVICENOW_CLIENT_ID "<client-id>"
azd env set SERVICENOW_CLIENT_SECRET "<client-secret>"
```

Optional:

```bash
azd env set SERVICENOW_DEFAULT_CATALOG "<catalog-sys-id>"
azd env set SERVICENOW_DEFAULT_CATEGORY "<category-sys-id>"
```

4. Provision and deploy:

```bash
azd up
```

5. Get deployed MCP endpoint URL:

```bash
azd env get-values | findstr MCP_ENDPOINT_URL
```

## Get Function Key (required for external calls)

This Function uses `authLevel: function`, so requests must include a valid function key.

1. Get Function App name:

```bash
azd env get-values | findstr FUNCTION_APP_NAME
```

2. List keys:

```bash
az functionapp function keys list \
  --resource-group <resource-group> \
  --name <function-app-name> \
  --function-name servicenow-mcp
```

Use one returned key as `x-functions-key` header or `?code=<key>` query parameter.

## Smoke Test (All 3 Tools)

Run end-to-end smoke test against local or deployed MCP endpoint:

```bash
set MCP_ENDPOINT_URL=https://<function-app-host>/mcp
set FUNCTION_KEY=<function-key>
set SEARCH_QUERY=laptop
set ORDER_VARIABLES_JSON={}
npm run smoke:test
```

Optional variables:

- `ITEM_SYS_ID`: use a specific catalog item instead of first search result
- `REQUESTED_FOR`: pass requested_for value to `place_order`

Notes:

- `place_order` may fail if required item variables are missing; set `ORDER_VARIABLES_JSON` to valid form values.

## Add to Microsoft Copilot Studio

1. In Copilot Studio, add a new MCP server integration.
2. Configure MCP server URL:
   - `https://<function-app-host>/mcp`
3. Configure authentication for MCP endpoint:
   - Header name: `x-functions-key`
   - Header value: `<function-key>`
4. Save and test tool discovery.
5. Verify all tools are visible:
   - `search_catalog_items`
   - `get_catalog_item_form`
   - `place_order`
6. Run a prompt test flow:
   - Discover items with `search_catalog_items`
   - Render/collect form from `get_catalog_item_form`
   - Submit order with `place_order`

## Security and Operations Notes

- ServiceNow client secret is stored in Key Vault (`servicenow-client-secret`) and referenced by app setting.
- Function App managed identity is granted `Key Vault Secrets User` role.
- Application Insights is enabled for monitoring.
- Use separate `azd` environments for dev/test/prod.

## Troubleshooting

- `401` from ServiceNow token endpoint:
  - Verify `SERVICENOW_CLIENT_ID` and `SERVICENOW_CLIENT_SECRET`.
  - Confirm token path (`SERVICENOW_OAUTH_TOKEN_PATH`).
- `401/403` calling MCP endpoint:
  - Verify function key is valid and passed correctly.
- Empty catalog search results:
  - Adjust query text.
  - Check optional default catalog/category filters.
