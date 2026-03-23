# Entra App Registration Validation Report

**Report Generated**: 2026-03-23  
**App Registration**: ServiceNow MCP Server  
**Application ID**: 44b3a088-05e3-4fcc-9216-d1b117ed489a  
**Current Status**: ✅ **VERIFIED FOR MULTI-TENANT OAUTH**

---

## Executive Summary

Your Entra app registration has been successfully configured for multi-tenant OAuth 2.0 support with Copilot Studio. All critical OAuth 2.0 requirements are met.

---

## Configuration Checklist

### ✅ Authentication & Tenancy

| Setting | Value | Status | Notes |
|---------|-------|--------|-------|
| **Sign-In Audience** | `AzureADMultipleOrgs` | ✅ CORRECT | Allows authentication from any tenant |
| **Tenant** | Primary Tenant | ✅ CORRECT | App registration location |

**Validation**: Multi-tenant sign-in is **enabled**. Users from any Microsoft tenant can authenticate to this app.

---

### ✅ OAuth 2.0 Audience Configuration

| Setting | Value | Status | Notes |
|---------|-------|--------|-------|
| **Application ID** | `44b3a088-05e3-4fcc-9216-d1b117ed489a` | ✅ CORRECT | Standard UUID format |
| **App ID URI** | `api://44b3a088-05e3-4fcc-9216-d1b117ed489a` | ✅ CORRECT | Follows RFC standards |
| **requestedAccessTokenVersion** | `2` | ✅ CORRECT | OAuth 2.0 v2 tokens (required) |

**Validation**: Token audience is correctly configured. MCP server will accept tokens with `aud` claim matching:
- `44b3a088-05e3-4fcc-9216-d1b117ed489a` (GUID format)
- `api://44b3a088-05e3-4fcc-9216-d1b117ed489a` (App ID URI format)

---

### ✅ OAuth 2.0 Scopes

| Scope | Admin Consent | User Consent | Status | Notes |
|-------|---------------|--------------|--------|-------|
| **access_as_user** | ✅ CONFIGURED | ✅ CONFIGURED | ✅ CORRECT | Allows users to delegate access |

**Admin Consent Display Name**: `Access ServiceNow MCP as user`
**User Consent Display Name**: `Access ServiceNow MCP as you`
**User Consent Description**: `Allow Copilot Studio to access ServiceNow MCP on your behalf`

**Validation**: Scope is enabled and has appropriate consent UI text. Users will see consent prompt when authenticating.

---

### ✅ Redirect URIs (OAuth 2.0 Callback)

| Redirect URI | Status | Purpose |
|--------------|--------|---------|
| `https://oauth.botframework.com/callback` | ✅ CONFIGURED | Copilot Studio OAuth callback |
| `https://global.consent.azure-apim.net/redirect` | ✅ CONFIGURED | Azure API Management consent callback |

**Validation**: Both required redirect URIs are registered. Copilot Studio can complete the authorization code flow and receive auth codes at these endpoints.

---

### ✅ Implicit Grant Settings

| Setting | Status | Notes |
|---------|--------|-------|
| **Access tokens (implicit flow)** | ✅ ENABLED | Needed for SPA-style clients |
| **ID tokens (implicit flow)** | ✅ ENABLED | Allows OIDC sign-in flow |

**Validation**: Implicit grant is enabled, supporting various client patterns (SPAs, JavaScript clients).

---

### ✅ Credentials (Client Secret)

| Credential | Status | Expires | Notes |
|------------|--------|---------|-------|
| **Client Secret** | ✅ ACTIVE | 2027-09-19 | Valid for 1.5+ years |

**Validation**: Application has a valid, non-expired client secret (generated 2024-09-19). Can be used for authorization code flow and client credentials flow.

---

### ✅ Required Resource Access

| Resource | Permission | Type | Status | Notes |
|----------|-----------|------|--------|-------|
| **Microsoft Graph** | `User.Read` | Delegated (Scope) | ✅ CONFIGURED | Allows reading user profile |

**Validation**: Application has permission to read basic user profile info from Microsoft Graph (standard permission).

---

## OAuth 2.0 Flows Supported

### 1. ✅ Authorization Code Flow (Primary - Copilot Studio)

**Sequence**:
1. Copilot Studio redirects to: `https://login.microsoftonline.com/{tenant_id}/oauth2/v2.0/authorize?client_id=44b3a088-05e3-4fcc-9216-d1b117ed489a&...`
2. User authenticates in their tenant
3. Microsoft Entra returns authorization code
4. Copilot Studio exchanges code for access token at MCP server's token endpoint
5. MCP server validates token at `/mcp` endpoint

**Status**: ✅ **FULLY SUPPORTED** by this app registration

**Prerequisite**: Remote tenant admin must have granted consent (see setup guide).

### 2. ✅ OpenID Connect Discovery (OIDC)

**Endpoint**: `/.well-known/openid-configuration`

**Returns**:
- `issuer`: `https://login.microsoftonline.com/{tenant_id}/v2.0`
- `authorization_endpoint`: Microsoft Entra authorization endpoint
- `token_endpoint`: Microsoft Entra token endpoint
- `scopes_supported`: `["api://44b3a088-05e3-4fcc-9216-d1b117ed489a/access_as_user", "openid", "profile", "email", "offline_access"]`

**Status**: ✅ **FULLY SUPPORTED** (implemented in MCP server)

### 3. ✅ Dynamic Client Registration (DCR)

**Endpoint**: `/oauth/register`

**Returns**:
- `client_id`: Pre-registered app ID
- `client_secret`: Working credential
- `scope`: `api://44b3a088-05e3-4fcc-9216-d1b117ed489a/access_as_user`

**Status**: ✅ **FULLY SUPPORTED** (implemented in MCP server)

---

## Cross-Tenant Compatibility

### Remote Tenant Token Acceptance

✅ **ENABLED** via MCP server configuration:

```env
# Settings in Azure Function App
ENTRA_TRUSTED_TENANT_IDS="<REMOTE_TENANT_GUID>"
```

When configured, the MCP server will accept and validate tokens from:
- **Primary Tenant** (where app registration lives)
- **Trusted Remote Tenants** (listed in ENTRA_TRUSTED_TENANT_IDS)
- **Any Tenant** (if ENTRA_ALLOW_ANY_TENANT=true)

**Validation Logic**:
1. Extract `tid` (tenant ID) from token
2. Check if `tid` is in trusted list
3. Fetch JWKS from that tenant's Entra endpoint
4. Verify signature and audience

**Status**: ✅ **READY FOR MULTI-TENANT DEPLOYMENT**

---

## Consent & Permissions

### 1. Primary Tenant (App Registration Tenant)

✅ **No action needed** - Admin consent is implicit for the home tenant.

### 2. Remote Tenant (Copilot Studio Tenant)

⚠️ **Admin consent required from each remote tenant**

Admin from remote tenant must visit:
```
https://login.microsoftonline.com/{REMOTE_TENANT_ID}/adminconsent?
  client_id=44b3a088-05e3-4fcc-9216-d1b117ed489a&
  redirect_uri=https://oauth.botframework.com/callback&
  scope=api://44b3a088-05e3-4fcc-9216-d1b117ed489a/access_as_user
```

After approval:
- App shows in remote tenant's **Enterprise Applications**
- Users can authenticate and receive tokens

**Example URL** (replace with actual tenant ID):
```
https://login.microsoftonline.com/f8cdef31-a31b-4234-b2be-1234567890ab/adminconsent?
  client_id=44b3a088-05e3-4fcc-9216-d1b117ed489a&
  redirect_uri=https://oauth.botframework.com/callback&
  scope=api://44b3a088-05e3-4fcc-9216-d1b117ed489a/access_as_user
```

---

## Deployment Readiness

### ✅ Entra App Configuration
- ✅ Multi-tenant enabled
- ✅ OAuth 2.0 audience configured correctly
- ✅ Scopes defined with user consent text
- ✅ Redirect URIs registered
- ✅ Client credentials valid

### ✅ MCP Server Code
- ✅ OIDC discovery endpoint implemented
- ✅ DCR (OAuth register) endpoint implemented
- ✅ Multi-tenant token validation implemented
- ✅ Bearer token middleware enforces validation

### ✅ Azure Deployment
- ✅ Code deployed to Azure Function App
- ✅ Environment variables configured
- ✅ ENTRA_AUDIENCE set to `api://44b3a088-05e3-4fcc-9216-d1b117ed489a`
- ✅ ENTRA_TRUSTED_TENANT_IDS can be added for remote tenants

### ⚠️ Remote Tenant (Copilot Studio)
- ⏳ **Pending**: Admin consent from remote tenant admin

---

## Next Steps

### For Setup Team

1. **☐ Identify Remote Tenant ID** where Copilot Studio is deployed
   - Format: `xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx` (GUID)
   - Find in: Azure Portal → Entra ID → Overview

2. **☐ Configure MCP Server Environment**
   ```bash
   azd env set ENTRA_TRUSTED_TENANT_IDS "f8cdef31-a31b-4234-b2be-1234567890ab"
   azd deploy
   ```

3. **☐ Obtain Remote Tenant Admin Consent**
   - Admin from remote tenant visits the consent URL (see above)
   - Approves "Access ServiceNow MCP as you" permission

4. **☐ Create Copilot Studio Connector**
   - In Copilot Studio, create new "Custom OpenAPI" connector
   - Provide OIDC endpoint: `https://func-sp2iostp7h6vq.azurewebsites.net/.well-known/openid-configuration`
   - Complete OAuth 2.0 setup flow

5. **☐ Test End-to-End**
   - User authenticates via Copilot Studio
   - Calls MCP endpoint with Bearer token
   - Verify in Application Insights: no 401 errors

---

## Verification Commands

### Check OIDC Discovery
```bash
curl -s https://func-sp2iostp7h6vq.azurewebsites.net/.well-known/openid-configuration | jq '.scopes_supported'
```

**Expected Output**:
```json
[
  "api://44b3a088-05e3-4fcc-9216-d1b117ed489a/access_as_user",
  "openid",
  "profile",
  "email",
  "offline_access"
]
```

### Check DCR
```bash
curl -X POST https://func-sp2iostp7h6vq.azurewebsites.net/oauth/register \
  -H "Content-Type: application/json" \
  -d '{
    "client_name": "Test",
    "response_types": ["code"],
    "redirect_uris": ["https://oauth.botframework.com/callback"]
  }' | jq '.'
```

**Expected Output** (HTTP 201):
```json
{
  "client_id": "44b3a088-05e3-4fcc-9216-d1b117ed489a",
  "client_secret": "...",
  "scope": "api://44b3a088-05e3-4fcc-9216-d1b117ed489a/access_as_user"
}
```

---

## Troubleshooting Reference

| Issue | Likely Cause | Resolution |
|-------|--------------|-----------|
| "Unauthenticated" in Copilot Studio | No admin consent in remote tenant | Admin must visit consent URL |
| Token validation error in logs | ENTRA_TRUSTED_TENANT_IDS not set | Add remote tenant GUID to env vars |
| "Invalid audience" error | Token for different app registration | Verify token scope matches `api://44b3a088-05e3-4fcc-9216-d1b117ed489a` |
| 401 on `/mcp` endpoint | Bearer token missing or invalid | Ensure Copilot Studio includes Authorization header |

---

## Summary

| Category | Status | Summary |
|----------|--------|---------|
| **Entra Configuration** | ✅ VERIFIED | App is properly configured for multi-tenant OAuth 2.0 |
| **MCP Server Code** | ✅ VERIFIED | Multi-tenant token validation implemented |
| **Azure Deployment** | ✅ VERIFIED | Code deployed and environment ready |
| **Cross-Tenant Support** | ✅ READY | Remote tenant integration can begin |
| **Overall Readiness** | ✅ READY | All components in place for production deployment |

**Next Action**: Obtain admin consent from remote tenant, then create Copilot Studio connector.

---

**Report URL**: [Entra App Registration](https://portal.azure.com/#view/Microsoft_AAD_RegisteredApps/ApplicationMenuBlade/~/Overview/appId/44b3a088-05e3-4fcc-9216-d1b117ed489a)  
**MCP Server URL**: `https://func-sp2iostp7h6vq.azurewebsites.net`
