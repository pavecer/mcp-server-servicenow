# ServiceNow MCP Server (Azure Functions)

This project hosts a stateless MCP server for ServiceNow on Azure Functions.

It provides four MCP tools:

- `search_catalog_items`: Search ServiceNow catalog items by free text intent (with optional category/catalog filtering). Returns matching items with their `sys_id`, `name`, `short_description`, `category`, `categorySysId`, `catalog`, `catalogSysId`, and a ready-to-render **Adaptive Card** (`selectionAdaptiveCard`) so the user can pick the right item interactively. Use `categorySysId`/`catalogSysId` from the results to restrict a follow-up search to the same category or catalog.
- `get_catalog_item_form`: Retrieve an item's variables and return an Adaptive Card form definition the user fills in before ordering.
- `place_order`: Place an order and return an Adaptive Card confirmation (request number, status, link).
- `validate_servicenow_configuration`: Validate OAuth token acquisition and effective permissions for Service Catalog APIs (`items` list, `item` detail, optional `order_now` probe).

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

## ServiceNow Setup

The MCP server depends on standard ServiceNow Service Catalog APIs. The Azure side only hosts the MCP endpoint; access to catalog items is ultimately determined by what the ServiceNow token is allowed to see and order.

### 1. Create or identify the OAuth application in ServiceNow

You need an OAuth application that can issue access tokens for ServiceNow API calls.

Minimum values required by this MCP server:

- ServiceNow instance URL, for example `https://your-instance.service-now.com`
- OAuth client ID
- OAuth client secret
- Token endpoint path, usually `/oauth_token.do`

The server supports two operating models:

1. Application token fallback
  - The MCP server uses the configured client ID and client secret to obtain a ServiceNow bearer token.
  - Catalog visibility and ordering rights are based on the permissions of that ServiceNow application or integration user.
2. Per-user token pass-through
  - The MCP caller sends `x-servicenow-access-token` with a ServiceNow user access token.
  - Catalog visibility and ordering rights are based on that ServiceNow user's permissions.

### 2. Enable access to Service Catalog APIs

This implementation calls these ServiceNow endpoints:

- `GET /api/sn_sc/servicecatalog/items`
- `GET /api/sn_sc/servicecatalog/items/{sys_id}`
- `POST /api/sn_sc/servicecatalog/items/{sys_id}/order_now`

Confirm that the OAuth application and the effective ServiceNow user behind the token are allowed to call these APIs.

### 3. Grant the correct ServiceNow permissions

The MCP server does not implement its own catalog authorization rules. It relies on ServiceNow to enforce them.

Make sure the effective user behind the token:

- can see the catalogs and categories that should be searchable
- can read the catalog item metadata and variables
- can submit requests for the selected catalog items
- has access to any dependent catalog variables, reference data, and request records needed after submission

If you use application token fallback, assign these rights to the integration user or service principal represented by the OAuth client.

If you use per-user token pass-through, assign these rights to the real end users or their groups/roles in ServiceNow.

### 4. Validate catalog visibility in ServiceNow first

Before testing the MCP server, validate directly in ServiceNow that the same token/user can:

- search and view the intended catalog items
- open the item form and read its variables
- submit an order for the item

If a catalog item is not visible in ServiceNow for that user, it will not become visible through this MCP server.

### 5. Decide which identity model you want in production

For production, choose one of these explicitly:

1. Shared integration identity
  - Simpler to operate
  - All MCP calls see whatever the integration identity can access
2. Per-user delegated identity
  - Aligns best with your requirement that each caller only sees items they already have access to
  - Requires the caller or integration layer to obtain a ServiceNow user token and send it as `x-servicenow-access-token`

### 6. Recommended ServiceNow validation checklist

- OAuth token issuance works with your chosen grant flow
- Token can call `/api/sn_sc/servicecatalog/items`
- Token can call `/api/sn_sc/servicecatalog/items/{sys_id}`
- Token can call `/api/sn_sc/servicecatalog/items/{sys_id}/order_now`
- Token returns only catalogs/items the effective user should see
- Ordered request is visible afterward to the same effective user

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

## Validate ServiceNow OAuth and Permissions

Use `validate_servicenow_configuration` to verify that your filled ServiceNow configuration works and that the effective identity has access to required Service Catalog APIs.

Default behavior:

- Uses `x-servicenow-access-token` if present.
- Otherwise validates configured `client_credentials` settings.
- Checks token/auth, catalog list access, and item detail access.
- Skips `order_now` by default to avoid accidental request creation.

Recommended first validation call:

```json
{
  "name": "validate_servicenow_configuration",
  "arguments": {
    "query": "laptop",
    "forceClientCredentials": true,
    "probeOrderNow": false
  }
}
```

Optional explicit order permission probe (can create a request in ServiceNow):

```json
{
  "name": "validate_servicenow_configuration",
  "arguments": {
    "query": "laptop",
    "probeOrderNow": true,
    "orderProbeItemSysId": "<test-item-sys-id>",
    "orderProbeVariables": {}
  }
}
```

Interpretation tips:

- `auth.client_credentials` failed: OAuth app settings (`instance`, `client_id`, `client_secret`, token path) are incorrect or token issuance is not allowed.
- `api.catalog.list` failed with `401/403`: identity is authenticated but lacks API or catalog rights.
- `api.catalog.list` passed with `foundCount=0`: query mismatch or limited catalog visibility for the identity.
- `api.catalog.order_now` warning: by default the order probe is skipped; set `probeOrderNow=true` only with a controlled test item.

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
   - Discover items with `search_catalog_items` — the response contains a `selectionAdaptiveCard` that renders each result as a tappable container; the user taps to select, which returns `{ action: "select_catalog_item", itemSysId, itemName }`.
   - Use the returned `itemSysId` to call `get_catalog_item_form` — the response contains an `adaptiveCard` with all required and optional input fields.
   - The user fills in the Adaptive Card form and submits; the submission returns field values keyed by variable name.
   - Call `place_order` with the collected variable values to submit the request — the response contains an `adaptiveCard` with the request number, status, and a link to ServiceNow.

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
