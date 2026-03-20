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
- Caller access model: if `x-servicenow-access-token` header is provided, ServiceNow calls run under that user token and respect that user's catalog permissions

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

4. Run locally:

```bash
npm run start:dev
```

The MCP endpoint will be available at:

- `http://localhost:7071/mcp`

## Deploy to Azure

### One-command deployment script (recommended)

Use the deployment script to configure ServiceNow connection settings, deploy to Azure, fetch the function key, and optionally run smoke tests.

Interactive mode:

```powershell
npm run deploy:azure
```

Non-interactive mode:

```powershell
pwsh -File scripts/deploy-azure.ps1 \
  -EnvironmentName dev \
  -Location westeurope \
  -SubscriptionId <subscription-id> \
  -ServiceNowInstanceUrl https://<instance>.service-now.com \
  -ServiceNowClientId <client-id> \
  -ServiceNowClientSecret <client-secret> \
  -ServiceNowOAuthTokenPath /oauth_token.do
```

Optional script parameters:

- `-SkipSmokeTest`

The script output includes values for Copilot Studio:

- MCP URL
- `x-functions-key` header value

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

## Caller Identity and ServiceNow Permissions

To enforce ServiceNow catalog visibility based on the caller, send a ServiceNow user access token in:

- Header: `x-servicenow-access-token: <servicenow-user-access-token>`

When this header is present, MCP tool calls use that token for ServiceNow API calls, so search and ordering follow that ServiceNow user's permissions.

If the header is not present, the server falls back to configured client credentials token.

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
2. In the MCP onboarding wizard:
  - **Server name**: ServiceNow MCP
  - **Server description**: MCP server for ServiceNow catalog search, order form retrieval, and order placement
  - **Server URL**: `https://<function-app-host>/mcp`
  - **Authentication type**: API key (Header)
    - **Header name**: `x-functions-key`
    - **Header value**: `<function-key>` (retrieved from Azure)
3. Save and allow Copilot Studio to discover tools automatically.
4. Verify all tools are visible:
   - `search_catalog_items`
   - `get_catalog_item_form`
   - `place_order`
5. (Optional) If you want ServiceNow calls to respect individual user permissions, configure your Copilot Studio integration layer to pass a ServiceNow user access token in the `x-servicenow-access-token` header for each MCP request. Without this header, the server uses app credentials (service principal).
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
  - Ensure your ServiceNow user (via x-servicenow-access-token header) or app credentials have access to the catalogs you're searching.
