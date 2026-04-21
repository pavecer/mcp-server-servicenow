# ServiceNow MCP Server

A stateless [Model Context Protocol](https://modelcontextprotocol.io) server for ServiceNow Service Catalog, hosted on Azure Functions. It connects Microsoft Copilot Studio to ServiceNow so users can search catalog items, fill order forms rendered as Adaptive Cards, and place orders from within a Copilot Studio agent.

**MCP tools provided:**

| Tool | Description |
|------|-------------|
| `search_catalog_items` | Full-text catalog search with Adaptive Card item picker |
| `get_catalog_item_form` | Returns an Adaptive Card form for the selected item |
| `place_order` | Submits the order and returns a confirmation Adaptive Card |
| `validate_servicenow_configuration` | Validates OAuth and catalog API access end-to-end |

**Related documentation:**

- [Copilot Studio Setup](COPILOT_STUDIO_SETUP.md) -- add MCP tool and configure ordering topic
- [ServiceNow Setup](docs/SERVICENOW_SETUP.md) -- OAuth app, integration user, and permissions
- [Action Contracts](docs/MCS_ACTION_CONTRACTS.md) -- tool schemas for Copilot Studio topic authors
- [Optional Container Deployment](docs/DEPLOY_CONTAINER_AZURE.md) -- run as one Docker container in Azure Container Apps
- [Security Guidelines](SECURITY.md) -- what to never commit

---

## Prerequisites

| Requirement | Notes |
|-------------|-------|
| Azure subscription | Permission to create resource groups and Entra app registrations |
| Azure CLI (az) | [Install guide](https://learn.microsoft.com/cli/azure/install-azure-cli) |
| Azure Developer CLI (azd) | [Install guide](https://learn.microsoft.com/azure/developer/azure-developer-cli/install-azd) |
| Node.js 20+ | To build the project locally |
| ServiceNow instance | Admin access to create OAuth apps and users |
| Microsoft Entra ID | Permission to register an app |

---

## Quick Start

### Step 1 -- Set up ServiceNow

See [docs/SERVICENOW_SETUP.md](docs/SERVICENOW_SETUP.md) for the complete guide, or run the automation script:

```powershell
pwsh -File scripts/setup-servicenow.ps1 \
  -InstanceUrl https://<instance>.service-now.com \
  -AdminUser <admin-username> \
  -AdminPassword <admin-password>
```

What you need from ServiceNow:
- **Client ID** and **Client Secret** from the OAuth App Registry entry
- **Integration user** username and password (with `catalog` role)

---

### Step 2 -- Register an Entra ID Application

This enables per-user OAuth 2.0 authentication in Copilot Studio.

1. [Azure Portal](https://portal.azure.com) > **Entra ID > App registrations > New registration**
   - Name: `ServiceNow MCP Server`
   - Supported account types: `Accounts in this organizational directory only`
   - Click **Register**
   - Note **Application (client) ID** = `ENTRA_CLIENT_ID`
   - Note **Directory (tenant) ID** = `ENTRA_TENANT_ID`

2. **Certificates & secrets > New client secret** -- copy the value immediately = `ENTRA_CLIENT_SECRET`

3. **Expose an API > Set** Application ID URI -- accept default `api://<ENTRA_CLIENT_ID>`
   - **Add a scope**: name `access_as_user`, consent: Admins and users

4. **Authentication > Add a platform > Web** -- add redirect URIs:
   ```
   https://oauth.botframework.com/callback
   https://global.consent.azure-apim.net/redirect
   https://copilotstudio.preview.microsoft.com/connection/oauth/redirect
   ```
   Enable **Access tokens** and **ID tokens** > **Save**

5. *(Recommended)* **API permissions > Add > My APIs > ServiceNow MCP Server** > `access_as_user` > **Grant admin consent**
   This lets all tenant users use the agent without individual consent prompts.

---

### Step 3 -- Deploy to Azure

**Interactive (recommended for first deployment):**

```powershell
npm run deploy:azure
```

The script prompts for all values, provisions Azure resources (Function App, Key Vault, Application Insights), deploys the function, and prints Copilot Studio setup instructions.

**Non-interactive (CI/CD):**

```powershell
pwsh -File scripts/deploy-azure.ps1 \
  -EnvironmentName prod \
  -Location westeurope \
  -SubscriptionId <subscription-id> \
  -ServiceNowInstanceUrl https://<instance>.service-now.com \
  -ServiceNowClientId <sn-client-id> \
  -ServiceNowClientSecret <sn-client-secret> \
  -ServiceNowUsername <integration-user> \
  -ServiceNowPassword <integration-user-password> \
  -EntraTenantId <entra-tenant-id> \
  -EntraClientId <entra-client-id> \
  -EntraClientSecret <entra-client-secret>
```

**Manual azd:**

```bash
az login && azd auth login
azd env new <env-name>
azd env set SERVICENOW_INSTANCE_URL  "https://<instance>.service-now.com"
azd env set SERVICENOW_CLIENT_ID     "<sn-client-id>"
azd env set SERVICENOW_CLIENT_SECRET "<sn-client-secret>"
azd env set SERVICENOW_USERNAME      "<integration-user>"
azd env set SERVICENOW_PASSWORD      "<integration-user-password>"
azd env set ENTRA_TENANT_ID          "<entra-tenant-id>"
azd env set ENTRA_CLIENT_ID          "<entra-client-id>"
azd env set ENTRA_CLIENT_SECRET      "<entra-client-secret>"
azd up
```

Get the deployed MCP endpoint URL:

```bash
azd env get-values | findstr MCP_ENDPOINT_URL
```

### Optional: Deploy as One Container (Azure Container Apps)

If you prefer a single container deployment instead of Azure Functions, use the Docker + Container Apps path documented in [docs/DEPLOY_CONTAINER_AZURE.md](docs/DEPLOY_CONTAINER_AZURE.md).

This path builds this repo as a single Node.js container and exposes the same MCP endpoint shape at `/mcp`.

---

### Step 4 -- Add to Microsoft Copilot Studio

See [COPILOT_STUDIO_SETUP.md](COPILOT_STUDIO_SETUP.md) for the full guide.

1. Copilot Studio > your agent > **Tools > Add a tool > Model Context Protocol**
2. Fill in:

   | Field | Value |
   |-------|-------|
   | Server name | `ServiceNow MCP` |
   | Server URL | `https://<your-function-app>.azurewebsites.net/mcp` |
   | Authentication | `OAuth 2.0` |
   | Type | `Dynamic discovery` |

3. Click **Create** > sign in when prompted > verify all 4 tools appear.
4. Import the ordering topic from `copilot-studio/topics/` into your agent.

---

## Architecture

- **Runtime**: Azure Functions v4, Node.js 20, Flex Consumption (FC1)
- **Transport**: Streamable HTTP, stateless MCP
- **MCP auth**: OAuth 2.0 via Microsoft Entra ID (per-user sign-in)
- **ServiceNow auth**: OAuth 2.0 password grant with a shared integration user
- **Secrets**: All secrets in Azure Key Vault; Function App reads via managed identity
- **Monitoring**: Application Insights

### Delegated Identity Flow

Each order is correctly attributed to the Copilot Studio user who placed it:

1. Copilot Studio sends the user's Entra Bearer token to the MCP server.
2. The MCP server validates the token and extracts the caller's UPN/email.
3. The server obtains a ServiceNow token for the integration user (password grant).
4. The caller's email is looked up in `sys_user` to find their ServiceNow `sys_id`.
5. The order is placed, then immediately PATCHed to set `requested_for` to the resolved user.

> **Integration user permissions needed**: read on `sys_user`, read+write on `sc_request`, plus `catalog` and/or `itil` roles.

---

## Local Development

```bash
npm install
cp local.settings.sample.json local.settings.json
# Edit local.settings.json -- ENTRA_AUTH_DISABLED is true by default for local use
npm run start:dev
```

MCP endpoint: `http://localhost:7071/mcp`

```bash
# Smoke test against local
set MCP_ENDPOINT_URL=http://localhost:7071/mcp
npm run smoke:test
```

---

## Environment Variables Reference

### Required

| Variable | Description |
|----------|-------------|
| `SERVICENOW_INSTANCE_URL` | ServiceNow base URL (`https://instance.service-now.com`) |
| `SERVICENOW_CLIENT_ID` | OAuth App Registry client ID |
| `SERVICENOW_CLIENT_SECRET` | OAuth App Registry client secret |
| `SERVICENOW_USERNAME` | Integration user login |
| `SERVICENOW_PASSWORD` | Integration user password |

### Entra ID (required for Copilot Studio OAuth)

| Variable | Description |
|----------|-------------|
| `ENTRA_TENANT_ID` | Entra directory (tenant) ID |
| `ENTRA_CLIENT_ID` | App registration client ID |
| `ENTRA_CLIENT_SECRET` | App registration client secret (for Dynamic Client Registration) |
| `ENTRA_AUDIENCE` | Expected `aud` in tokens; defaults to `api://<ENTRA_CLIENT_ID>` |

### Optional

| Variable | Default | Description |
|----------|---------|-------------|
| `ENTRA_AUTH_DISABLED` | `false` | Skip Bearer validation -- local dev only, never in production |
| `ENTRA_OAUTH_SCOPES` | `api://<ENTRA_CLIENT_ID>/access_as_user openid profile offline_access` | Scopes advertised in OIDC discovery |
| `ENTRA_TRUSTED_TENANT_IDS` | _(empty)_ | Accepted remote tenant IDs (multi-tenant scenarios) |
| `ENTRA_ALLOW_ANY_TENANT` | `false` | Accept any Microsoft tenant token |
| `ENTRA_DCR_REGISTRATION_TOKEN` | _(unset)_ | Bearer token required on `POST /oauth/register` |
| `ENTRA_DCR_ALLOW_UNAUTHENTICATED` | `false` | Allow open Dynamic Client Registration when no token is configured |
| `CORS_ALLOWED_ORIGINS` | _(empty)_ | Comma-separated browser origins for CORS-enabled endpoints |
| `SERVICENOW_OAUTH_TOKEN_PATH` | `/oauth_token.do` | ServiceNow token endpoint path |
| `SERVICENOW_OAUTH_GRANT_TYPE` | `auto` | Override grant type: `password` or `client_credentials` |
| `SERVICENOW_REQUESTED_FOR_LOOKUP_FIELDS` | `email,user_name` | `sys_user` fields for identity resolution |
| `SERVICENOW_REQUESTED_FOR_CALLER_FIELDS` | `callerUpn` | Entra token claims to use as identity source |
| `SERVICENOW_REQUESTED_FOR_FALLBACK_TO_CALLER_VALUE` | `true` | Fall back to UPN if no `sys_user` match |
| `SERVICENOW_REQUESTED_FOR_DIAGNOSTICS` | `false` | Include requested_for diagnostics in tool/API responses |
| `SERVICENOW_REQUESTED_FOR_DIAGNOSTICS_INCLUDE_PII` | `false` | Include raw caller identifiers in diagnostics (for short-lived troubleshooting only) |

---

## Smoke Testing Deployed Endpoint

```bash
set MCP_ENDPOINT_URL=https://<function-app>.azurewebsites.net/mcp
set ENTRA_BEARER_TOKEN=<access-token>
npm run smoke:test
```

Get a token:

```bash
az account get-access-token --resource api://<ENTRA_CLIENT_ID> --query accessToken -o tsv
```

---

## Troubleshooting

**401 on MCP endpoint** -- Entra auth is active and no valid Bearer token was sent. Check the Copilot Studio connection (user must have signed in). For local testing, set `ENTRA_AUTH_DISABLED=true`.

**Orders created but `requested_for` is wrong** -- The post-order PATCH failed. Verify:
- Integration user has **write** on `sc_request` in ServiceNow.
- Caller's Entra email matches `sys_user.email` or `sys_user.user_name`.
- Application Insights traces for `[ServiceNowClient.placeOrder.requestedForPatchFailed]`.

**Dynamic discovery fails in Copilot Studio** -- Verify `ENTRA_TENANT_ID` and `ENTRA_CLIENT_ID` are set. Confirm the OIDC endpoint returns 200. If you changed OAuth settings after the MCP tool was added, **delete and re-add the connection** -- Power Platform caches OIDC metadata on first connect.

**validate_servicenow_configuration errors** -- Run with `probeOrderNow: false` first to isolate auth vs. catalog access issues.

---

## Security

All secrets are stored in Azure Key Vault. The Function App reads them via managed identity. No credentials appear in app settings in plaintext.

- `local.settings.json` is excluded by `.gitignore` -- never commit it.
- Never deploy with `ENTRA_AUTH_DISABLED=true`.
- Keep `/oauth/register` protected with `ENTRA_DCR_REGISTRATION_TOKEN` (recommended).
- Keep `ENTRA_DCR_ALLOW_UNAUTHENTICATED=false` in enterprise environments.
- Keep `SERVICENOW_REQUESTED_FOR_DIAGNOSTICS_INCLUDE_PII=false` unless you are actively debugging and have an approved retention path.
- Prefer `SERVICENOW_REQUIRE_CALLER_ACCESS_TOKEN=true` when enterprise policy requires per-user ServiceNow ACL enforcement.

See [SECURITY.md](SECURITY.md) for full guidelines.

---

## Engineering Guardrails

Apply these rules for every new feature, bug fix, refactor, or deployment-related change in this repository.

### Local Development Files

- Treat `local.settings.json` as developer-local configuration.
- Do not sanitize, template, overwrite, or reformat `local.settings.json` unless the user explicitly asks for that file to be changed.
- Apply security improvements in committed source files, scripts, infrastructure, and docs instead of rewriting local developer secrets files.

### Logging And Diagnostics

- Route new operational logs through the structured logger in `src/utils/logger.ts`.
- Never log secrets, bearer tokens, passwords, client secrets, function keys, cookies, or raw authorization headers.
- Do not log caller PII by default. Any diagnostics that may expose user identity must be opt-in and disabled by default.
- Keep error output sanitized. Avoid returning or logging full upstream payloads when they may contain tokens, identifiers, or request content.

### Identity And Access

- Prefer least privilege for both ServiceNow and Entra configuration.
- Avoid broad ServiceNow roles when narrower ACLs or scoped access can satisfy the requirement.
- Prefer delegated/per-user enforcement when enterprise requirements demand user-level authorization boundaries.
- Do not add Microsoft Graph or unrelated Entra permissions unless they are strictly required by the implemented feature.

### API And OAuth Surface

- Use explicit CORS allowlists for browser-facing endpoints. Avoid wildcard origins for enterprise-exposed APIs.
- Keep Dynamic Client Registration secure by default. Require a registration token unless open registration is an intentional, reviewed choice.
- Preserve MCP protocol compatibility when changing transport, discovery, or tool metadata behavior.

### Documentation Expectations

- Update repo documentation whenever behavior, configuration, permissions, or security posture changes.
- Add concise function-level comments when behavior is non-obvious, especially in auth, logging, transport, or security-sensitive code paths.
- Document new environment variables, defaults, and security implications in the repo.

### Review Standard

Before considering a change complete, verify:

- No secrets or PII were added to logs, responses, docs, or tracked files.
- `local.settings.json` was left untouched unless explicitly requested.
- New permissions are justified and minimized.
- User-facing and operator-facing documentation matches the implementation.
