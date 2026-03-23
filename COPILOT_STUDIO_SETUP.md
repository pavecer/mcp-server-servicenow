# Copilot Studio Setup & Troubleshooting

## Error: "Failed to login. Could not discover authorization server metadata"

This error occurs when Copilot Studio cannot access or parse the OIDC discovery endpoint.

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
  - Redirect URIs must include: `https://oauth.botframework.com/callback`
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
