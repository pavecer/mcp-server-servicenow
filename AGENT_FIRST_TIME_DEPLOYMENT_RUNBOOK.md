# Agent First-Time Deployment Runbook

## Purpose

This runbook is for coding agents and maintainers who need to deploy this ServiceNow MCP server to Azure correctly on the first try, including cross-tenant scenarios and Copilot Studio OAuth dynamic discovery.

It captures the exact deployment sequence, required configuration locations, and known failure modes.

## Scope

- Azure Functions deployment via azd
- Single-tenant and cross-tenant Entra OAuth setup
- Copilot Studio MCP setup verification

## Important Project Facts

- Service host is Azure Functions with routePrefix set to empty in host.json.
- MCP endpoint route is /mcp.
- OIDC discovery endpoint route is /.well-known/openid-configuration.
- OAuth authorization server alias route is /.well-known/oauth-authorization-server.
- OAuth protected resource metadata route is /.well-known/oauth-protected-resource.
- Dynamic client registration endpoint route is /oauth/register.
- Infrastructure parameters are sourced from .azure/<env>/config.json under infra.parameters.
- Runtime environment values are stored in .azure/<env>/.env.
- Unauthenticated POST requests to /mcp must return HTTP 401 with a WWW-Authenticate header that includes resource_metadata pointing at /.well-known/oauth-protected-resource.

## Critical Rule (Most Common Deployment Mistake)

Do not rely only on .env for infrastructure values.

For this project, Bicep receives required values from:
- .azure/<env>/config.json
- path: infra.parameters.*

If Entra values exist only in .env but not in infra.parameters, deployment can succeed but OIDC discovery may return:
- {"error":"Entra ID is not configured on this server"}

## Prerequisites

- Azure CLI installed and logged in
- Azure Developer CLI (azd) installed
- Node.js installed
- Access to target Azure subscription and tenant
- Contributor permissions on target subscription/resource group

## First-Time Deployment Procedure

### 1. Select target tenant and subscription

Use Azure CLI login for the target tenant:

```powershell
az login --tenant <TARGET_TENANT_ID>
az account set --subscription <TARGET_SUBSCRIPTION_ID>
```

If Conditional Access requires claims challenge, use the exact challenge from the error:

```powershell
az login --tenant <TARGET_TENANT_ID> --claims-challenge <CLAIMS_CHALLENGE>
```

### 2. Authenticate azd to the same tenant

```powershell
azd auth login --tenant-id <TARGET_TENANT_ID>
azd config set auth.useAzCliAuth true
```

### 3. Create/select azd environment

```powershell
azd env new <ENV_NAME> --no-prompt
# or, if it already exists
azd env select <ENV_NAME>
```

### 4. Set required infra parameters (mandatory)

Set these in azd config (infra.parameters), not only in .env:

```powershell
azd env config set infra.parameters.environmentName <ENV_NAME>
azd env config set infra.parameters.serviceNowInstanceUrl <SERVICENOW_INSTANCE_URL>
azd env config set infra.parameters.serviceNowClientId <SERVICENOW_CLIENT_ID>
azd env config set infra.parameters.serviceNowClientSecret <SERVICENOW_CLIENT_SECRET>
```

If OAuth is enabled, also set Entra parameters in infra.parameters:

```powershell
azd env config set infra.parameters.entraTenantId <ENTRA_TENANT_ID>
azd env config set infra.parameters.entraClientId <ENTRA_CLIENT_ID>
azd env config set infra.parameters.entraClientSecret <ENTRA_CLIENT_SECRET>
azd env config set infra.parameters.entraAudience <ENTRA_AUDIENCE>
azd env config set infra.parameters.entraTrustedTenantIds <COMMA_SEPARATED_TENANT_IDS>
azd env config set infra.parameters.entraAllowAnyTenant false
```

### 5. Set core azd environment values

```powershell
azd env set AZURE_LOCATION <AZURE_REGION>
azd env set AZURE_SUBSCRIPTION_ID <TARGET_SUBSCRIPTION_ID>
azd env set AZURE_TENANT_ID <TARGET_TENANT_ID>
```

### 6. Deploy

```powershell
npm run build
azd up --no-prompt
```

## Post-Deployment Validation

### 1. Confirm function routes exist

```powershell
az functionapp function list --resource-group <RG> --name <FUNCTION_APP_NAME> --query "[].{name:name,route:config.bindings[0].route}" -o table
```

Expected routes include:
- mcp
- .well-known/openid-configuration
- oauth/register

### 2. Confirm Entra app settings are populated

```powershell
az functionapp config appsettings list --resource-group <RG> --name <FUNCTION_APP_NAME> --query "[?starts_with(name, 'ENTRA_')].[name,value]" -o table
```

Expected:
- ENTRA_TENANT_ID has value
- ENTRA_CLIENT_ID has value
- ENTRA_AUDIENCE has value
- ENTRA_TRUSTED_TENANT_IDS or ENTRA_ALLOW_ANY_TENANT is set as intended

### 3. Confirm OIDC discovery endpoint

Open in browser:
- https://<FUNCTION_APP_NAME>.azurewebsites.net/.well-known/openid-configuration
- https://<FUNCTION_APP_NAME>.azurewebsites.net/.well-known/oauth-authorization-server
- https://<FUNCTION_APP_NAME>.azurewebsites.net/.well-known/oauth-protected-resource

Expected:
- HTTP 200
- JSON with issuer, authorization_endpoint, token_endpoint
- registration_endpoint present when ENTRA_CLIENT_SECRET is configured
- oauth-protected-resource returns authorization_servers with the Function App base URL

### 4. Confirm MCP unauthenticated challenge is correct

Run:

```powershell
Invoke-WebRequest -Method POST -Uri https://<FUNCTION_APP_NAME>.azurewebsites.net/mcp -Body '{}' -ContentType 'application/json' -SkipHttpErrorCheck
```

Expected:
- HTTP 401
- `WWW-Authenticate` header present
- Header includes `resource_metadata="https://<FUNCTION_APP_NAME>.azurewebsites.net/.well-known/oauth-protected-resource"`

## Copilot Studio Setup (Dynamic Discovery)

In Copilot Studio:
- Tools -> Add a tool -> Model Context Protocol
- Server URL: https://<FUNCTION_APP_NAME>.azurewebsites.net/mcp
- Authentication: OAuth 2.0
- Type: Dynamic discovery

Then complete sign-in.

Important:
- Power Platform caches OAuth metadata when the connector is created.
- If you change OAuth endpoints, Entra redirect URIs, or deploy a fix for discovery behavior, delete the Copilot Studio connection and recreate it.
- For the current working setup, the Entra app registration includes these redirect URIs:
  - `https://oauth.botframework.com/callback`
  - `https://global.consent.azure-apim.net/redirect`
  - `https://global.consent.azure-apim.net/redirect/cr7a3-5fservicenow-20mcp-5f635855ea92fead22`
  - `https://copilotstudio.preview.microsoft.com/connection/oauth/redirect`

## Known Errors and Fixes

### Error: Entra ID is not configured on this server

Cause:
- Missing or empty ENTRA_TENANT_ID / ENTRA_CLIENT_ID at runtime.
- Most often caused by setting only .env and not infra.parameters before provisioning.

Fix:
1. Set missing infra.parameters.entra* values with azd env config set.
2. Run azd up again.
3. Re-check function app appsettings for ENTRA_* values.

### Error: Popup closes instantly or consent proxy says no consent server information

Cause:
- Connector was created before OAuth discovery endpoints were fully correct.
- Power Platform cached empty or stale OAuth metadata.

Fix:
1. Confirm these endpoints return HTTP 200:
  - `/.well-known/openid-configuration`
  - `/.well-known/oauth-authorization-server`
  - `/.well-known/oauth-protected-resource`
2. Confirm unauthenticated `POST /mcp` returns 401 with `WWW-Authenticate` including `resource_metadata=...`.
3. Delete the Copilot Studio connection and recreate it.

### Error: Redirect URI mismatch during Entra login

Cause:
- Power Platform may send a connector-specific redirect URI, not only the base consent redirect.

Fix:
1. Inspect the HAR / authorize request.
2. Add the exact redirect URI used by Entra to the app registration.
3. For this repo's current connector, the required URI was:
  - `https://global.consent.azure-apim.net/redirect/cr7a3-5fservicenow-20mcp-5f635855ea92fead22`

### Error: AADSTS50076 or reauthentication required

Cause:
- MFA/Conditional Access token not fresh.

Fix:
1. Re-run az login for target tenant.
2. If prompted with claims challenge, run az login with --claims-challenge.
3. Ensure azd auth login is done for same tenant.

### Error: azd cannot resolve access to subscription

Cause:
- azd authenticated to different tenant than AZURE_SUBSCRIPTION_ID.

Fix:
1. azd auth login --tenant-id <TARGET_TENANT_ID>
2. azd env set AZURE_TENANT_ID <TARGET_TENANT_ID>
3. azd env set AZURE_SUBSCRIPTION_ID <TARGET_SUBSCRIPTION_ID>

## Idempotent Agent Checklist

Before deploy:
- [ ] Correct az tenant/subscription selected
- [ ] azd environment selected
- [ ] infra.parameters has ServiceNow required values
- [ ] infra.parameters has Entra values when OAuth is expected
- [ ] AZURE_SUBSCRIPTION_ID and AZURE_TENANT_ID set in env

After deploy:
- [ ] MCP route exists
- [ ] OIDC route exists
- [ ] oauth-authorization-server route exists
- [ ] oauth-protected-resource route exists
- [ ] ENTRA_* app settings are populated
- [ ] Discovery endpoint returns valid JSON
- [ ] POST /mcp returns 401 with WWW-Authenticate resource_metadata
- [ ] Copilot Studio connector can sign in

## Optional Emergency Runtime Patch

If deployment succeeded but OIDC still reports missing Entra config, patch app settings directly:

```powershell
az functionapp config appsettings set --resource-group <RG> --name <FUNCTION_APP_NAME> --settings \
  ENTRA_TENANT_ID=<ENTRA_TENANT_ID> \
  ENTRA_CLIENT_ID=<ENTRA_CLIENT_ID> \
  ENTRA_CLIENT_SECRET=<ENTRA_CLIENT_SECRET> \
  ENTRA_AUDIENCE=<ENTRA_AUDIENCE> \
  ENTRA_TRUSTED_TENANT_IDS=<TRUSTED_TENANTS> \
  ENTRA_ALLOW_ANY_TENANT=false
```

Then retest discovery endpoint.

## Security Notes

- Do not commit production secrets to repository files.
- Prefer secret values via secure channels and Key Vault-backed configuration.
- Use ENTRA_TRUSTED_TENANT_IDS instead of ENTRA_ALLOW_ANY_TENANT=true in production.
