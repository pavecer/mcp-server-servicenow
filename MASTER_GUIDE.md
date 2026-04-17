# ServiceNow MCP Server - Master Guide

This is the canonical guide for this repository. It consolidates architecture, setup, deployment, security, and operations into one document.

## 1. What This Project Does

This project provides a stateless Model Context Protocol (MCP) server for ServiceNow running on Azure Functions.

Primary capabilities:
- Search ServiceNow catalog items
- Render order forms for selected catalog items
- Place ServiceNow catalog orders
- Validate ServiceNow connectivity and permissions

Core endpoints:
- `/mcp` (MCP tool endpoint)
- `/.well-known/openid-configuration`
- `/.well-known/oauth-authorization-server`
- `/.well-known/oauth-protected-resource`
- `/oauth/register`
- `/health`

## 2. Architecture

Runtime and hosting:
- Azure Functions v4 (Node.js 20)
- Flex Consumption plan (FC1)
- Express app bridged into Azure Functions using `serverless-http`
- Streamable MCP HTTP transport in stateless mode

Authentication model:
- Inbound caller auth: Microsoft Entra Bearer token validation
- Outbound ServiceNow auth: OAuth token obtained by integration credentials
- Optional caller token passthrough: `x-servicenow-access-token`

Secrets model:
- Production secrets are stored in Azure Key Vault
- Function App reads secrets via Key Vault references
- Local development uses `local.settings.json` (never commit real values)

High-level flow:
1. Copilot/client calls `POST /mcp` with Entra Bearer token.
2. Server validates JWT signature, issuer, tenant trust model, audience, and time claims.
3. Server executes MCP tool logic.
4. Tool calls ServiceNow APIs with either caller token (if provided) or integration token.
5. Tool returns JSON payload and Adaptive Card data.

## 3. Repository Layout

- `src/` application source
- `src/functions/` Azure Function handlers
- `src/services/` Entra validator, ServiceNow client, token manager
- `src/tools/` MCP tool registrations and handlers
- `infra/main.bicep` Azure IaC
- `scripts/deploy-azure.ps1` deployment script
- `docs/` implementation and runbooks for Copilot Studio ordering flows

## 4. Prerequisites

Required:
- Node.js 20+
- npm
- Azure CLI (`az`)
- Azure Developer CLI (`azd`)
- Azure Functions Core Tools v4

Optional but recommended:
- PowerShell 7+

## 5. Local Setup

1. Install dependencies:
```bash
npm install
```

2. Build:
```bash
npm run build
```

3. Configure local settings:
```bash
cp local.settings.sample.json local.settings.json
```

4. Fill `local.settings.json` values:
- `SERVICENOW_INSTANCE_URL`
- `SERVICENOW_CLIENT_ID`
- `SERVICENOW_CLIENT_SECRET`
- `SERVICENOW_USERNAME`
- `SERVICENOW_PASSWORD`
- `SERVICENOW_OAUTH_TOKEN_PATH` (default `/oauth_token.do`)

5. Run locally:
```bash
npm run start:dev
```

6. Quick health check:
```bash
curl http://localhost:7071/health
```

## 6. Azure Deployment (Recommended Path)

1. Authenticate:
```bash
az login
azd auth login
```

2. Create/select environment:
```bash
azd env new <ENV_NAME>
# or
azd env select <ENV_NAME>
```

3. Set required infra parameters:
```bash
azd env config set infra.parameters.environmentName <ENV_NAME>
azd env config set infra.parameters.serviceNowInstanceUrl "https://<your-instance>.service-now.com"
azd env config set infra.parameters.serviceNowClientId "<SERVICENOW_CLIENT_ID>"
azd env config set infra.parameters.serviceNowClientSecret "<SERVICENOW_CLIENT_SECRET>"
```

4. Set optional Entra parameters:
```bash
azd env config set infra.parameters.entraTenantId "<ENTRA_TENANT_ID>"
azd env config set infra.parameters.entraClientId "<ENTRA_CLIENT_ID>"
azd env config set infra.parameters.entraClientSecret "<ENTRA_CLIENT_SECRET>"
azd env config set infra.parameters.entraAudience "api://<ENTRA_CLIENT_ID>"
azd env config set infra.parameters.entraTrustedTenantIds "<TENANT_GUID_1>,<TENANT_GUID_2>"
azd env config set infra.parameters.entraAllowAnyTenant "false"
```

5. Deploy:
```bash
npm run build
azd up
```

## 7. Entra and OAuth Setup

Minimum Entra app requirements:
- Redirect URIs configured for Copilot Studio/Power Platform
- API scope exposed (recommended: `access_as_user`)
- Token version set to v2
- Client secret configured for DCR if using `/oauth/register`

Cross-tenant options:
- `ENTRA_TRUSTED_TENANT_IDS` for explicit allow-list
- `ENTRA_ALLOW_ANY_TENANT=true` only for controlled test scenarios

## 8. MCP Tools and Process Flow

Supported MCP tools:
- `search_catalog_items`
- `get_catalog_item_form`
- `place_order`
- `validate_servicenow_configuration`

Ordering process:
1. Agent searches catalog by intent.
2. User selects item.
3. Agent fetches form schema/Adaptive Card.
4. User submits form variables.
5. Agent places order.
6. Agent returns confirmation and request reference.

## 9. Security Baseline

Current controls in this repo:
- Strict Bearer token validation
- Multi-tenant trust checks
- Signature verification via tenant JWKS
- Request body size limit and media-type enforcement on MCP POST
- Security headers for HTTP responses
- Key Vault references in Azure app settings
- `.gitignore` includes local secrets and azd environment state

Mandatory operational rules:
- Never commit real values in `local.settings.json`
- Never commit `.env`, `.azure/`, logs, HAR files, or personal tokens
- Rotate any credential immediately if exposure is suspected

## 10. Validation and Smoke Testing

Build validation:
```bash
npm run build
```

Functional smoke test script:
```bash
npm run smoke:test
```

Expected auth behavior:
- `POST /mcp` without Bearer token returns `401` with `WWW-Authenticate`
- OIDC and OAuth metadata endpoints return `200`

## 11. Troubleshooting Quick Map

- OAuth discovery/login issues: check OIDC endpoints and recreate Copilot connection
- `invalid_client` from ServiceNow: verify app registry client ID/secret and token path
- `invalid_grant`: verify integration username/password and grant mode
- `Invalid audience`: ensure token scope/audience matches app configuration
- `Token issued by untrusted tenant`: update trusted tenant list or tenant mode

## 12. Reference Documents

Primary references:
- `README.md`
- `SECURITY.md`
- `docs/CUSTOMER_IMPLEMENTATION_GUIDE.md`
- `docs/MCS_SERVICENOW_ORDERING_RUNBOOK.md`
- `docs/MCS_ACTION_CONTRACTS.md`
- `CROSS_TENANT_OAUTH_SETUP.md`
- `COPILOT_STUDIO_SETUP.md`

## 13. Public Repository Safety Checklist

Before every push:
- Confirm no real secret values in tracked files
- Confirm `local.settings.json` is placeholder-only or excluded
- Confirm `.azure/` and logs are untracked
- Confirm no HAR/exported auth traces are staged
- Run `npm run build` to validate changes
