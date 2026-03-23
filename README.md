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
- **MCP authentication**: OAuth 2.0 via Microsoft Entra ID (primary) — each Copilot Studio user signs in individually
- ServiceNow auth: OAuth 2.0 password grant with a shared integration user
- Secrets: client secrets stored in Azure Key Vault and referenced by Function App app settings
- Caller access model: all Service Catalog calls run under the configured ServiceNow integration user. If `x-servicenow-access-token` header is provided, that user token is used instead.

## Prerequisites

- Node.js 20+
- npm
- Azure Functions Core Tools v4
- Azure Developer CLI (`azd`)
- Azure CLI (`az`)
- A Microsoft **Entra ID** (Azure AD) app registration for MCP authentication (see Entra ID Setup below)
- A ServiceNow OAuth application registered in the **Application Registry** (see ServiceNow Setup below)

## Entra ID Setup (for Copilot Studio OAuth 2.0)

This is the primary authentication mechanism for the MCP server when added to Copilot Studio.
It enables the **OAuth 2.0 → Dynamic discovery** authentication type in the Copilot Studio MCP wizard,
so every user in your tenant authenticates individually with their Microsoft identity.

### 1. Register an Entra ID application

1. In the [Azure portal](https://portal.azure.com), navigate to **Entra ID > App registrations > New registration**.
2. Fill in:
   - **Name**: `ServiceNow MCP Server` (or any descriptive name)
   - **Supported account types**: `Accounts in this organizational directory only (Single tenant)`
   - **Redirect URI**: leave blank for now
3. Click **Register**.
4. Note the **Application (client) ID** — this is your `ENTRA_CLIENT_ID`.
5. Note the **Directory (tenant) ID** — this is your `ENTRA_TENANT_ID`.

### 2. Create a client secret

1. In the app registration, go to **Certificates & secrets > Client secrets > New client secret**.
2. Set a description and expiry, then click **Add**.
3. Copy the **Value** immediately — this is your `ENTRA_CLIENT_SECRET` (shown only once).

### 3. Add a redirect URI for Copilot Studio

1. In the app registration, go to **Authentication > Add a platform > Web**.
2. Add the Copilot Studio OAuth redirect URI:
   ```
   https://oauth.botframework.com/callback
   ```
3. Check **Access tokens** and **ID tokens** under **Implicit grant**, then **Save**.

### 4. Expose an API scope (required for OAuth 2.0 token issuance)

1. In the app registration, go to **Expose an API**.
2. Click **Set** next to **Application ID URI** and accept the default `api://<ENTRA_CLIENT_ID>`.
3. Click **Add a scope**:
   - **Scope name**: `access_as_user` (or any name)
   - **Who can consent**: `Admins and users`
   - **Admin consent display name**: `Access ServiceNow MCP as user`
   - Click **Add scope**.

> The `ENTRA_AUDIENCE` env var should be set to `api://<ENTRA_CLIENT_ID>` if you configure an Application ID URI.
> If you leave `ENTRA_AUDIENCE` empty the server accepts both `api://<ENTRA_CLIENT_ID>` and the raw GUID as valid audiences.

### 5. (Optional) Pre-consent the scope for all tenant users

To avoid individual user consent prompts when the Copilot Studio agent is shared broadly:

1. In the app registration, go to **API permissions > Add a permission > My APIs**.
2. Select the `ServiceNow MCP Server` app and add the `access_as_user` permission.
3. Click **Grant admin consent for \<your tenant\>**.

This makes the agent work for all tenant users without each needing to consent individually — important for a broadly shared Copilot Studio agent.

---

## ServiceNow Setup

The MCP server depends on standard ServiceNow Service Catalog APIs. The Azure side only hosts the MCP endpoint; access to catalog items is ultimately determined by what the ServiceNow token is allowed to see and order.

### 1. Create an OAuth application in the ServiceNow Application Registry

Navigate to **System OAuth > Application Registry** and create a new application:

- Select **Create an OAuth API endpoint for external clients**
- Fill in:
  - **Name**: give the application a descriptive name (for example `MCP Server`)
  - **Client ID**: auto-generated; copy it after saving
  - **Client Secret**: auto-generated; copy the value while it is displayed (or click **Generate** / the lock icon to reveal/reset it)
  - **Redirect URL**: leave blank or set to a placeholder (not used by this flow)
  - **Default Grant Type**: select **Password Credentials**
  - **Active**: checked

Save the record. Copy the **Client ID** and **Client Secret** values.

> **Why Password Credentials?**
> ServiceNow's standard Application Registry supports the OAuth 2.0 **Password** grant (`grant_type=password`) out of the box.
> The **Client Credentials** grant (`grant_type=client_credentials`) requires an additional system property
> (`glide.oauth.inbound.client.credential.grant_type.enabled = true`) that must be manually created in System Properties —
> this is not part of the standard App Registry UI and is why client-credentials-only setups commonly fail without extra configuration.

### 2. Create or identify the integration user

The Password grant requires a ServiceNow user account whose credentials the server will use to obtain tokens.

Create a dedicated integration user (or reuse an existing service account):

1. Navigate to **User Administration > Users** and create a new user.
2. Set a strong, stable password.
3. On the user record, assign the roles required for Service Catalog access (at minimum `catalog` or `itil`).
4. Ensure the user is **Active** and not locked out.

Note the **username** and **password** — these go into `SERVICENOW_USERNAME` and `SERVICENOW_PASSWORD`.

The server supports two operating models:

1. Integration user authentication (Password grant)
  - The MCP server uses `SERVICENOW_CLIENT_ID`, `SERVICENOW_CLIENT_SECRET`, `SERVICENOW_USERNAME`, and `SERVICENOW_PASSWORD` to obtain a ServiceNow bearer token.
  - Catalog visibility and ordering rights are based on the integration user's permissions.
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

If you use the integration user identity, assign these rights to that ServiceNow user account.

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

3. Copy the sample settings file and fill in values:

```bash
cp local.settings.sample.json local.settings.json
```

Required settings:

| Variable | Purpose |
|---|---|
| `SERVICENOW_INSTANCE_URL` | ServiceNow instance base URL |
| `SERVICENOW_CLIENT_ID` | ServiceNow OAuth App Registry client ID |
| `SERVICENOW_CLIENT_SECRET` | ServiceNow OAuth App Registry client secret |
| `SERVICENOW_USERNAME` | ServiceNow integration user login |
| `SERVICENOW_PASSWORD` | ServiceNow integration user password |

Optional settings for Entra auth (production; leave blank for local testing):

| Variable | Purpose |
|---|---|
| `ENTRA_TENANT_ID` | Entra tenant ID |
| `ENTRA_CLIENT_ID` | Entra app registration client ID |
| `ENTRA_CLIENT_SECRET` | Entra client secret (required for DCR) |
| `ENTRA_AUDIENCE` | Expected `aud` in Entra tokens (default: `api://<ENTRA_CLIENT_ID>`) |
| `ENTRA_AUTH_DISABLED` | Set `true` to skip Bearer token validation locally (default in sample: `true`) |

> **Local testing tip**: `ENTRA_AUTH_DISABLED=true` is pre-set in the sample so that the smoke test and direct curl/tool calls work without an Entra token. Never deploy with this flag set to `true`.

4. Run locally:

```bash
npm run start:dev
```

The MCP endpoint will be available at `http://localhost:7071/mcp`.
The OIDC discovery endpoint will be available at `http://localhost:7071/.well-known/openid-configuration`.

## Deploy to Azure

### One-command deployment script (recommended)

Interactive mode:

```powershell
npm run deploy:azure
```

Non-interactive mode (with Entra):

```powershell
pwsh -File scripts/deploy-azure.ps1 `
  -EnvironmentName dev `
  -Location westeurope `
  -SubscriptionId <subscription-id> `
  -ServiceNowInstanceUrl https://<instance>.service-now.com `
  -ServiceNowClientId <servicenow-client-id> `
  -ServiceNowClientSecret <servicenow-client-secret> `
  -ServiceNowUsername <integration-user> `
  -ServiceNowPassword <integration-user-password> `
  -EntraTenantId <entra-tenant-id> `
  -EntraClientId <entra-client-id> `
  -EntraClientSecret <entra-client-secret>
```

When `EntraTenantId` is provided the script outputs **Copilot Studio OAuth 2.0 Dynamic discovery** setup instructions.
When it is omitted the output shows the API key values instead (fallback).

Optional parameters: `-SkipSmokeTest`

### Manual azd deployment

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
azd env set SERVICENOW_CLIENT_ID "<servicenow-client-id>"
azd env set SERVICENOW_CLIENT_SECRET "<servicenow-client-secret>"
azd env set SERVICENOW_USERNAME "<integration-user>"
azd env set SERVICENOW_PASSWORD "<integration-user-password>"
# Entra auth (required for Copilot Studio OAuth 2.0)
azd env set ENTRA_TENANT_ID "<entra-tenant-id>"
azd env set ENTRA_CLIENT_ID "<entra-client-id>"
azd env set ENTRA_CLIENT_SECRET "<entra-client-secret>"
```

4. Provision and deploy:

```bash
azd up
```

5. Get deployed MCP endpoint URL:

```bash
azd env get-values | findstr MCP_ENDPOINT_URL
```

## Add to Microsoft Copilot Studio

### Primary: OAuth 2.0 — Dynamic discovery (recommended for shared tenant agents)

This option uses Entra ID for authentication. Each user in your tenant signs in individually, and the agent can be shared broadly without any per-user key management.

**Requirements**: Entra ID app registration configured (see [Entra ID Setup](#entra-id-setup-for-copilot-studio-oauth-20)).

1. In Copilot Studio, open your agent and go to **Tools > Add a tool > Model Context Protocol**.
2. In the wizard, fill in:

   | Field | Value |
   |---|---|
   | Server name | `ServiceNow MCP` |
   | Server description | `MCP server for ServiceNow catalog search, order form retrieval, and order placement` |
   | Server URL | `https://<function-app-host>/mcp` |
   | Authentication | `OAuth 2.0` |
   | Type | `Dynamic discovery` |

3. Click **Create**. Copilot Studio reads `https://<function-app-host>/.well-known/openid-configuration` automatically, finds the `registration_endpoint`, and calls it to complete OAuth client registration.
4. When prompted to **create a connection**, sign in with any account in your Entra tenant to authorize.
5. Verify all tools are visible:
   - `search_catalog_items`
   - `get_catalog_item_form`
   - `place_order`
   - `validate_servicenow_configuration`

> **Why this works for broad sharing**: because authentication is via Entra, every user in the tenant can use the agent without individual configuration. Copilot Studio obtains an Entra access token for each user and passes it to the MCP server, which validates it before serving any requests.

---

### Fallback A: OAuth 2.0 — Dynamic (no automatic DCR)

Use this when `ENTRA_CLIENT_SECRET` is not set (you don't want the server to expose the secret through the DCR endpoint) but you still want OAuth.

1. Use the same MCP wizard but select **OAuth 2.0 → Dynamic**.
2. Enter the OAuth details manually:
   - **Authorization endpoint**: `https://login.microsoftonline.com/<ENTRA_TENANT_ID>/oauth2/v2.0/authorize`
   - **Token endpoint**: `https://login.microsoftonline.com/<ENTRA_TENANT_ID>/oauth2/v2.0/token`
   - **Client ID**: `<ENTRA_CLIENT_ID>`
   - **Client secret**: `<ENTRA_CLIENT_SECRET>` (entered in the wizard, not exposed by the server)
   - **Scope**: `api://<ENTRA_CLIENT_ID>/access_as_user` (or `<ENTRA_CLIENT_ID>/.default`)

---

### Fallback B: API key (Entra not configured)

When `ENTRA_TENANT_ID` is not set, the MCP server does not enforce Entra auth and can be protected with an Azure Function key.

1. Use the MCP wizard with **Authentication → API key**.

   | Field | Value |
   |---|---|
   | Authentication | `API key` |
   | API key type | `Header` |
   | Header name | `x-functions-key` |

2. Retrieve the function key:

```bash
az functionapp function keys list \
  --resource-group <resource-group> \
  --name <function-app-name> \
  --function-name servicenow-mcp
```

3. Paste the key value when the wizard prompts for the API key.

> **Note**: API key authentication is a shared secret and is not suitable for broadly shared tenant agents. Use Entra OAuth 2.0 for production deployments.

---

### Caller Identity and ServiceNow Permissions

With Entra OAuth, each caller's Entra identity (`oid`, `preferred_username`) is extracted from the Bearer token and logged. ServiceNow API calls still use the configured integration user (service account). To route ServiceNow calls under a specific user instead, send the ServiceNow token in the `x-servicenow-access-token` header alongside the Entra Bearer token.

## Validate ServiceNow OAuth and Permissions

Use `validate_servicenow_configuration` to verify that OAuth token acquisition and Service Catalog access work end-to-end.

Default behavior:

- Uses `x-servicenow-access-token` if present.
- Otherwise validates configured integration user credentials (password grant).
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

Optional explicit order permission probe:

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

## Smoke Test (All 3 Tools)

Run end-to-end smoke test against local or deployed MCP endpoint:

```bash
# Local (ENTRA_AUTH_DISABLED=true must be set in local.settings.json)
set MCP_ENDPOINT_URL=http://localhost:7071/mcp
npm run smoke:test

# Deployed (no function key required when Entra auth is configured)
set MCP_ENDPOINT_URL=https://<function-app-host>/mcp
set SEARCH_QUERY=laptop
set ORDER_VARIABLES_JSON={}
npm run smoke:test
```

Optional variables: `ITEM_SYS_ID`, `REQUESTED_FOR`

> `place_order` may fail if required item variables are missing; set `ORDER_VARIABLES_JSON` to valid form values.

## Security and Operations Notes

- `ENTRA_CLIENT_SECRET` is stored in Key Vault (`entra-client-secret`) and referenced by app setting.
- ServiceNow credentials (`SERVICENOW_CLIENT_SECRET`, `SERVICENOW_PASSWORD`) are stored in Key Vault.
- Function App managed identity is granted `Key Vault Secrets User` role.
- Application Insights is enabled for monitoring.
- Use separate `azd` environments for dev/test/prod.
- Never set `ENTRA_AUTH_DISABLED=true` in a deployed environment.

## Troubleshooting

### MCP endpoint returns 401

- Entra auth is active but no Bearer token was sent. Ensure Copilot Studio is configured with OAuth 2.0 and the connection has been created.
- If testing locally, set `ENTRA_AUTH_DISABLED=true` in `local.settings.json`.

### Dynamic discovery fails in Copilot Studio

- Verify `ENTRA_TENANT_ID` and `ENTRA_CLIENT_ID` are set in Function App settings.
- Visit `https://<function-app-host>/.well-known/openid-configuration` in a browser to confirm the endpoint responds.
- Verify `ENTRA_CLIENT_SECRET` is set; the `registration_endpoint` is only included in the discovery document when a secret is configured.

### 401 from ServiceNow token endpoint

- Verify `SERVICENOW_CLIENT_ID`, `SERVICENOW_CLIENT_SECRET`, `SERVICENOW_USERNAME`, and `SERVICENOW_PASSWORD`.
- Confirm token path (`SERVICENOW_OAUTH_TOKEN_PATH`), usually `/oauth_token.do`.
- Ensure the integration user account is **active** and not locked in ServiceNow.

### Empty catalog search results

- Adjust the query text.
- Ensure the ServiceNow integration user has catalog visibility (role `catalog` or `itil`).

### Grant type reference

| Grant type | When to use | Extra ServiceNow setup required |
|---|---|---|
| `password` (default when username/password are set) | Standard App Registry, works out of the box | None — just the App Registry record and an active integration user |
| `client_credentials` | Machine-to-machine without a user account | Must manually create system property `glide.oauth.inbound.client.credential.grant_type.enabled = true` in **System Properties** |
