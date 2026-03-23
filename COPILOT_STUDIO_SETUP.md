# Copilot Studio Setup & Troubleshooting

## Error: "Failed to login. Could not discover authorization server metadata"

This error occurs when Copilot Studio cannot access or parse the OIDC discovery endpoint.

### Root Cause Checklist

#### 1. **Entra App Registration Issues**

- [ ] **Verify Entra app registration exists**
  ```
  ENTRA_TENANT_ID: 1938ee32-a258-454c-b8db-3a928341bd69
  ENTRA_CLIENT_ID: 44b3a088-05e3-4fcc-9216-d1b117ed489a
  ```
  Go to [Azure Portal](https://portal.azure.com) → Entra ID → App registrations
  - Search for client ID `44b3a088-05e3-4fcc-9216-d1b117ed489a`
  - Verify app exists and is **Active**

- [ ] **Redirect URI configured**
  - Authentication → Platform configurations → Web
  - Redirect URIs must include: `https://oauth.botframework.com/callback`
  - Implicit grant: **Enable ID tokens** and **Access tokens**

- [ ] **API scope exposed**
  - Expose an API → Application ID URI = `api://44b3a088-05e3-4fcc-9216-d1b117ed489a`
  - Add scope: `access_as_user` (scope name)

- [ ] **Client secret is valid**
  - Certificates & secrets → Client secrets
  - Verify secret `9Ct8Q~tKniqm3_Z3CSpiOJozczbJQLPXmgJJQcLU` exists and hasn't expired

#### 2. **OIDC Endpoint Accessibility**

- [ ] **Test OIDC discovery endpoint directly**
  ```
  https://func-sp2iostp7h6vq.azurewebsites.net/.well-known/openid-configuration
  ```
  - Should return HTTP 200 with JSON body
  - Must include: `issuer`, `authorization_endpoint`, `token_endpoint`
  - If using DCR (Dynamic Client Registration): must include `registration_endpoint`

- [ ] **Check function app logs**
  - Azure Portal → Function App `func-sp2iostp7h6vq`
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
  - Server URL: `https://func-sp2iostp7h6vq.azurewebsites.net/mcp`
  - Authentication: `OAuth 2.0`
  - Type: `Dynamic discovery`
  - **NOT** `https://func-sp2iostp7h6vq.azurewebsites.net/api/...`

- [ ] **Ensure correct tenant context**
  - Sign in to Copilot Studio with an account in tenant `1938ee32-a258-454c-b8db-3a928341bd69`
  - When creating connection, authenticate with the same tenant

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
3. Search for application ID `44b3a088-05e3-4fcc-9216-d1b117ed489a`
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
2. Application ID URI: Set to `api://44b3a088-05e3-4fcc-9216-d1b117ed489a`
3. Scopes: Add `access_as_user`
   - Scope name: `access_as_user`
   - Admin consent: `Access ServiceNow MCP as user`
4. Click **Add scope**

### Step 4: Redeploy Function App

```powershell
cd c:\Users\pavelvecer\GitHub\mcp-server-servicenow
npm run build
azd deploy --environment dev
```

### Step 5: Re-test in Copilot Studio

1. In Copilot Studio agent → **Tools > Add a tool > Model Context Protocol**
2. Server name: `ServiceNow MCP`
3. Server URL: `https://func-sp2iostp7h6vq.azurewebsites.net/mcp`
4. Authentication: `OAuth 2.0`
5. Type: `Dynamic discovery`
6. Click **Create**
7. When prompted to sign in → Use account from tenant `1938ee32-a258-454c-b8db-3a928341bd69`

---

## If Problem Persists

### Check Function App Logs

```bash
# SSH into function app and view logs
az functionapp log config \
  --resource-group rg-dev \
  --name func-sp2iostp7h6vq \
  --application-logging true \
  --detailed-error-messages true

# Stream logs
az webapp log tail \
  --resource-group rg-dev \
  --name func-sp2iostp7h6vq
```

### Check OIDC Endpoint Manually (from local machine)

```powershell
$response = Invoke-WebRequest `
  -Uri "https://func-sp2iostp7h6vq.azurewebsites.net/.well-known/openid-configuration" `
  -Method GET

$response.StatusCode
$response.Content | ConvertFrom-Json | ForEach-Object { $_ | Add-Member -NotePropertyName Keys -NotePropertyValue ($_ | Get-Member -MemberType NoteProperty | Select-Object -ExpandProperty Name); $_ } 
```

### Alternative: Use API Key Instead of OAuth

If DCR/OAuth continues failing, use API key authentication instead:

1. Get function key:
```bash
az functionapp function keys list \
  --resource-group rg-dev \
  --name func-sp2iostp7h6vq \
  --function-name mcp
```

2. In Copilot Studio:
   - Authentication: **API key**
   - Key type: **Header**
   - Header name: `x-functions-key`
   - Paste the key

---

## Summary of Your Setup

| Component | Value |
|-----------|-------|
| Tenant ID | `1938ee32-a258-454c-b8db-3a928341bd69` |
| Entra Client ID | `44b3a088-05e3-4fcc-9216-d1b117ed489a` |
| Function App | `func-sp2iostp7h6vq` |
| MCP Endpoint | `https://func-sp2iostp7h6vq.azurewebsites.net/mcp` |
| OIDC Discovery | `https://func-sp2iostp7h6vq.azurewebsites.net/.well-known/openid-configuration` |
| ServiceNow Instance | `https://dev310193.service-now.com/` |
