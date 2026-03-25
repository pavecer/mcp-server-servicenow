# Copilot Studio Setup & Troubleshooting

## ServiceNow Ordering Topic Implementation

For the end-to-end topic-based ordering implementation (intent -> search -> item selection card -> order form card -> submit order), use these artifacts:

- Topic blueprint YAML: [copilot-studio/topics/servicenow-ordering.topics.yaml](copilot-studio/topics/servicenow-ordering.topics.yaml)
- Action contracts: [docs/MCS_ACTION_CONTRACTS.md](docs/MCS_ACTION_CONTRACTS.md)
- Full setup and test runbook: [docs/MCS_SERVICENOW_ORDERING_RUNBOOK.md](docs/MCS_SERVICENOW_ORDERING_RUNBOOK.md)

If your Copilot Studio environment does not support direct YAML topic import, create topics manually and map the nodes from the YAML blueprint.

## Error: "Failed to login. Could not discover authorization server metadata"

This error occurs when Copilot Studio cannot access or parse the OIDC discovery endpoint.

### CRITICAL: Recreate connection after any server OAuth changes

The Power Platform consent proxy **caches the connector's OAuth server info when the
connector is first created**. If the MCP server's OIDC endpoints didn't exist or returned
errors when the connector was first set up, the connector's OAuth metadata will be empty or
stale — the consent proxy will then return "No consent server information was associated
with this request" and the popup closes instantly.

**Fix**: Delete the MCP connection from Copilot Studio and re-add it from scratch after
confirming the server's OIDC endpoints return 200:

1. In Copilot Studio → **Tools** → find the ServiceNow MCP tool → **Remove**
2. Go to **Settings** → **Connections** → delete the `ServiceNow MCP` connection entry
3. Go to **Power Platform Admin Center** → verify the connector is also removed
4. Re-add the MCP server from scratch (see setup steps below)

This is required whenever:
- ENTRA_* environment variables were empty when you first set up the connector
- The server was redeployed with OAuth changes after initial connector creation
- You see the popup close instantly with no Entra login page appearing

### Diagnostics: Popup closes instantly without showing login

If you see the connection popup close in under 5 seconds with no Entra login dialog:
1. This means the consent proxy failed before even reaching Entra
2. Key diagnostic: check App Insights for any calls to `/.well-known/openid-configuration`
  or `/oauth/register` in the window when the popup was open — if there are none, the
  connector has stale/empty OAuth metadata and must be recreated
3. Fix: follow the "Recreate connection" steps above


### Root Cause Checklist

#### 1. **Entra App Registration Issues**

- [ ] **Verify Entra app registration exists**
  ```
  ENTRA_TENANT_ID: <your-primary-tenant-guid>
  ENTRA_CLIENT_ID: <your-app-registration-client-id>
  ```
  Go to [Azure Portal](https://portal.azure.com) → Entra ID → App registrations
  - Search for your client ID
  - Verify app exists and is **Active**

- [ ] **Redirect URI configured**
  - Authentication → Platform configurations → Web
  - Redirect URIs must include:
    - `https://oauth.botframework.com/callback`
    - `https://global.consent.azure-apim.net/redirect`
    - `https://copilotstudio.preview.microsoft.com/connection/oauth/redirect`
    - `https://global.consent.azure-apim.net/redirect/cr7a3-5fservicenow-20mcp-5f635855ea92fead22`
  - Implicit grant: **Enable ID tokens** and **Access tokens**

- [ ] **API scope exposed**
  - Expose an API → Application ID URI = `api://<your-client-id>`
  - Add scope: `access_as_user` (scope name)

- [ ] **Client secret is valid**
  - Certificates & secrets → Client secrets
  - Verify secret exists and hasn't expired

#### 2. **OIDC Endpoint Accessibility**

- [ ] **Test OIDC discovery endpoint directly**
  ```
  https://<your-function-app>.azurewebsites.net/.well-known/openid-configuration
  ```
  - Should return HTTP 200 with JSON body
  - Must include: `issuer`, `authorization_endpoint`, `token_endpoint`
  - If using DCR (Dynamic Client Registration): must include `registration_endpoint`

- [ ] **Test MCP OAuth compatibility endpoints**
  ```
  https://<your-function-app>.azurewebsites.net/.well-known/oauth-authorization-server
  https://<your-function-app>.azurewebsites.net/.well-known/oauth-protected-resource
  ```
  - Both should return HTTP 200
  - `oauth-protected-resource` must list the Function App base URL in `authorization_servers`

- [ ] **Test unauthenticated POST challenge**
  - `POST https://<your-function-app>.azurewebsites.net/mcp` with no Bearer token should return HTTP 401
  - Response must include `WWW-Authenticate` with `resource_metadata=`

- [ ] **Check function app logs**
  - Azure Portal → Function App
  - Go to Monitor → Logs
  - Query for errors from the oidc-discovery function
  - Look for timeout errors when fetching Microsoft metadata

- [ ] **Verify environment variables are set in Function App**
  - Azure Portal → Function App → Configuration
  - Application settings should include:
    - `ENTRA_TENANT_ID`
    - `ENTRA_CLIENT_ID`
    - `ENTRA_CLIENT_SECRET`
  - **If missing**, redeploy: `azd deploy --environment dev`

#### 3. **Copilot Studio Configuration**

- [ ] **Use the correct MCP URL**
  - Server URL: `https://<your-function-app>.azurewebsites.net/mcp`
  - Authentication: `OAuth 2.0`
  - Type: `Dynamic discovery`
  - **NOT** `https://<your-function-app>.azurewebsites.net/api/...`

- [ ] **Cross-tenant scenario**
  - If Copilot Studio runs in a **different** Entra tenant than the Function App, ensure
    your Entra app registration is set to **multi-tenant** (Accounts in any organizational
    directory) and the environment variables below are configured:
    ```
    # Allow tokens from Copilot Studio's tenant (Option 1 – explicit list):
    ENTRA_TRUSTED_TENANT_IDS="<copilot-studio-tenant-guid>"

    # Or accept any Microsoft tenant (Option 2 – open):
    ENTRA_ALLOW_ANY_TENANT="true"
    ```
  - See [CROSS_TENANT_OAUTH_SETUP.md](CROSS_TENANT_OAUTH_SETUP.md) for the full guide.

#### 4. **Network & Firewall**

- [ ] **OIDC endpoint is not blocked**
  - Ensure the Function App public endpoint is accessible
  - No VNet restrictions preventing Copilot Studio from reaching it
  - No WAF (Web Application Firewall) blocking `.well-known` requests

---

## Quick Fix Checklist

### Step 1: Verify Entra App Exists in Portal

1. Go to [Azure Portal](https://portal.azure.com)
2. Search for "App registrations"
3. Search for your application ID
4. If **not found** → Need to create the Entra app first (see below)
5. If **found** → Proceed to Step 2

### Step 2: Configure Redirect URI (if app exists)

1. In app registration → **Authentication**
2. Platform configurations → **Web** (add if missing)
3. Redirect URIs:
   - Add: `https://oauth.botframework.com/callback`
  - Add: `https://global.consent.azure-apim.net/redirect`
  - Add: `https://copilotstudio.preview.microsoft.com/connection/oauth/redirect`
  - Add: `https://global.consent.azure-apim.net/redirect/cr7a3-5fservicenow-20mcp-5f635855ea92fead22`
4. Implicit grant and hybrid flows:
   - ✅ Check **ID tokens**
   - ✅ Check **Access tokens**
5. Click **Save**

### Step 3: Expose API

1. In app registration → **Expose an API**
2. Application ID URI: Set to `api://<your-client-id>`
3. Scopes: Add `access_as_user`
   - Scope name: `access_as_user`
   - Admin consent: `Access ServiceNow MCP as user`
4. Click **Add scope**

### Step 4: Redeploy Function App

```powershell
npm run build
azd deploy --environment dev
```

### Step 5: Re-test in Copilot Studio

1. In Copilot Studio agent → **Tools > Add a tool > Model Context Protocol**
2. Server name: `ServiceNow MCP`
3. Server URL: `https://<your-function-app>.azurewebsites.net/mcp`
4. Authentication: `OAuth 2.0`
5. Type: `Dynamic discovery`
6. Click **Create**
7. When prompted to sign in → Use an account that has access to the app registration

---

## If Problem Persists

### Check Function App Logs

```bash
# SSH into function app and view logs
az functionapp log config \
  --resource-group <your-resource-group> \
  --name <your-function-app> \
  --application-logging true \
  --detailed-error-messages true

# Stream logs
az webapp log tail \
  --resource-group <your-resource-group> \
  --name <your-function-app>
```

### Check OIDC Endpoint Manually (from local machine)

```powershell
$response = Invoke-WebRequest `
  -Uri "https://<your-function-app>.azurewebsites.net/.well-known/openid-configuration" `
  -Method GET

$response.StatusCode
$response.Content | ConvertFrom-Json
```

### Check MCP OAuth Challenge Manually

```powershell
$response = Invoke-WebRequest `
  -Uri "https://<your-function-app>.azurewebsites.net/mcp" `
  -Method POST `
  -ContentType "application/json" `
  -Body '{}' `
  -SkipHttpErrorCheck

$response.StatusCode
$response.Headers["WWW-Authenticate"]
```

Expected:
- Status code = `401`
- `WWW-Authenticate` contains `resource_metadata="https://<your-function-app>.azurewebsites.net/.well-known/oauth-protected-resource"`

### Alternative: Use API Key Instead of OAuth

If DCR/OAuth continues failing, use API key authentication instead:

1. Get function key:
```bash
az functionapp function keys list \
  --resource-group <your-resource-group> \
  --name <your-function-app> \
  --function-name mcp
```

2. In Copilot Studio:
   - Authentication: **API key**
   - Key type: **Header**
   - Header name: `x-functions-key`
   - Paste the key

---

## Summary of Required Environment Variables

| Variable | Required | Description |
|----------|----------|-------------|
| `ENTRA_TENANT_ID` | Yes | Primary Entra tenant GUID where the app registration lives |
| `ENTRA_CLIENT_ID` | Yes | App registration client (application) ID |
| `ENTRA_CLIENT_SECRET` | For DCR | Client secret – enables Dynamic Client Registration in discovery doc |
| `ENTRA_AUDIENCE` | No | Override expected token audience (defaults to `api://<client-id>`) |
| `ENTRA_TRUSTED_TENANT_IDS` | Cross-tenant | Comma-separated remote tenant GUIDs to accept tokens from |
| `ENTRA_ALLOW_ANY_TENANT` | Cross-tenant | Set `"true"` to accept tokens from any Microsoft tenant |
