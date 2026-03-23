# Cross-Tenant OAuth 2.0 Setup Guide

## Overview

This MCP server supports **cross-tenant OAuth 2.0 authentication**, allowing Copilot Studio (or other clients) running in a different Microsoft Entra tenant to authenticate and use the MCP server via OAuth 2.0 dynamic discovery and Bearer tokens.

**Key Scenario**: 
- Azure Function (MCP server) deployed in **Tenant A**
- Copilot Studio client running in **Tenant B**
- Both use a **single multi-tenant Entra App Registration** for authentication

---

## Prerequisites

### 1. Entra App Registration Configuration

Your app registration must be configured for multi-tenant support:

#### A. Enable Multi-Tenant Sign-In
- **Azure Portal** → **Entra ID** → **App Registrations** → Your app
- **Authentication** tab:
  - **Supported account types**: Select `"Accounts in any organizational directory (Any Azure AD tenant - Multitenant)"`
  - Save

#### B. Configure OAuth 2.0 Audience
- **App Registration** → **Manifest** tab
- Locate the `"api"` section and ensure:
  ```json
  {
    "api": {
      "requestedAccessTokenVersion": 2,
      "oauth2PermissionScopes": [
        {
          "adminConsentDisplayName": "Access ServiceNow MCP as user",
          "adminConsentDescription": "Access ServiceNow MCP as user",
          "id": "YOUR_SCOPE_ID",
          "isEnabled": true,
          "type": "User",
          "userConsentDisplayName": "Access ServiceNow MCP as you",
          "userConsentDescription": "Allow Copilot Studio to access ServiceNow MCP on your behalf",
          "value": "access_as_user"
        }
      ]
    }
  }
  ```
- **requestedAccessTokenVersion** must be `2` (OAuth 2.0 v2 tokens)
- **userConsentDisplayName** and **userConsentDescription** should be populated for consent UI

#### C. Configure App ID URI
- **App Registration** → **Expose an API** tab
- **Application ID URI** must be set to:
  ```
  api://<APPLICATION_ID>
  ```
  Example: `api://ENTRA_CLIENT_ID_PLACEHOLDER`

#### D. Configure Redirect URIs
- **Authentication** tab → **Web** section
- Ensure **Redirect URIs** include:
  ```
  https://oauth.botframework.com/callback
  https://global.consent.azure-apim.net/redirect
  ```

---

## Server Configuration

### Environment Variables

Deploy the following environment variables to your Azure Function App:

```bash
# Primary Entra tenant (where the app registration lives)
ENTRA_TENANT_ID="<PRIMARY_TENANT_GUID>"

# App registration details
ENTRA_CLIENT_ID="<APPLICATION_ID>"
ENTRA_CLIENT_SECRET="<CLIENT_SECRET>"

# Expected token audience (matches App ID URI)
ENTRA_AUDIENCE="api://<APPLICATION_ID>"

# For multi-tenant support, specify which remote tenants are trusted for token validation.
# Option 1: List specific trusted tenant GUIDs (comma-separated)
ENTRA_TRUSTED_TENANT_IDS="<REMOTE_TENANT_GUID_1>,<REMOTE_TENANT_GUID_2>"

# Option 2: Accept tokens from any Microsoft tenant (use with caution)
ENTRA_ALLOW_ANY_TENANT="false"  # Set to "true" only if you trust all tenants
```

### Configuration Precedence

1. **ENTRA_TENANT_ID** (Required): Primary tenant where app registration lives
2. **ENTRA_TRUSTED_TENANT_IDS** (Optional): Comma-separated list of remote tenant GUIDs to accept
3. **ENTRA_ALLOW_ANY_TENANT** (Optional): Set to `"true"` to accept any Microsoft tenant

> **Security Note**: `ENTRA_ALLOW_ANY_TENANT=true` is permissive and relies solely on audience validation. Use specific `ENTRA_TRUSTED_TENANT_IDS` for production.

---

## Client-Side: Obtaining Admin Consent (Remote Tenant)

If Copilot Studio is in a different tenant (Remote Tenant), an admin from that tenant must consent to the app registration.

### Step 1: Construct Admin Consent URL

An admin from the remote tenant must visit this URL and grant consent:

```
https://login.microsoftonline.com/{REMOTE_TENANT_ID}/adminconsent?
  client_id={APPLICATION_ID}&
  redirect_uri=https://oauth.botframework.com/callback&
  scope=api://{APPLICATION_ID}/access_as_user
```

**Example**:
```
https://login.microsoftonline.com/f8cdef31-a31b-4234-b2be-1234567890ab/adminconsent?
  client_id=ENTRA_CLIENT_ID_PLACEHOLDER&
  redirect_uri=https://oauth.botframework.com/callback&
  scope=api://ENTRA_CLIENT_ID_PLACEHOLDER/access_as_user
```

### Step 2: Admin Review & Approve

The admin logs in with their remote tenant credentials and approves:
- **App Name**: ServiceNow MCP Server
- **Permissions Requested**: "Access ServiceNow MCP as you"

After approval, the app gains consent in the remote tenant, and users from that tenant can authenticate.

---

## Token Validation Flow

### Token Extraction

1. Copilot Studio obtains authorization code from `authorization_endpoint`
2. Exchanges code for access token using Remote Tenant's token endpoint
3. Token includes `tid` claim = Remote Tenant ID (identity of issuing tenant)
4. Sends token to MCP server: `Authorization: Bearer <token>`

### Server-Side Validation (New Multi-Tenant Logic)

**Step 1**: Extract `tid` (tenant ID) from JWT claims
```typescript
const tokenTenantId = payload.tid;  // e.g., "f8cdef31-a31b-4234-b2be-1234567890ab"
```

**Step 2**: Validate tenant is trusted
```typescript
const isTrustedTenant = 
  tokenTenantId === primaryTenantId ||  // Primary tenant?
  trustedTenantIds.includes(tokenTenantId) ||  // In trusted list?
  allowAnyTenant;  // Accept any tenant?
```

**Step 3**: If `isTrustedTenant`, validate remaining claims
- Signature verification using remote tenant's JWKS endpoint
- Audience validation
- Expiration and time skew
- Issuer format

**Step 4**: On success, create `RequestContext` with caller identity

```typescript
res.locals.callerEntraObjectId = payload.oid;  // Object ID in remote tenant
res.locals.callerUpn = payload.preferred_username;  // e.g., user@remotetenant.com
```

---

## Troubleshooting

### ❌ Error: "Token issued by untrusted tenant"

**Cause**: Token came from a tenant not in `ENTRA_TRUSTED_TENANT_IDS` and `ENTRA_ALLOW_ANY_TENANT` is false.

**Fix**:
1. Identify the remote tenant ID (appear in error message)
2. Add it to `ENTRA_TRUSTED_TENANT_IDS`
3. Redeploy with updated environment variable

### ❌ Error: "Invalid audience"

**Cause**: Token's `aud` claim doesn't match `ENTRA_AUDIENCE`.

**Fix**:
1. Verify `ENTRA_AUDIENCE` is set to the App ID URI: `api://<APPLICATION_ID>`
2. Check Entra app registration has correct identifierUris
3. Ensure Copilot Studio initiates consent flow with correct App ID

### ❌ Error: "Token has expired"

**Cause**: Token is outside allowed clock skew (default: 5 minutes).

**Fix**:
1. Verify system clocks are synchronized (NTP)
2. Wait and retry if clock skew is temporary

### ❌ Copilot Studio shows "Unauthenticated"

**Possible Causes**:
1. Admin consent not granted in remote tenant
2. Remote tenant not added to `ENTRA_TRUSTED_TENANT_IDS`
3. Token validation error (see Application Insights logs)

**Diagnostics**:
1. Check Azure Application Insights for token validation errors
2. Verify OAuth endpoints are working via OIDC discovery
3. Confirm admin consent was granted (portal → Enterprise Applications)

---

## Verification Checklist

### ✅ Server Configuration
- [ ] `ENTRA_TENANT_ID` set to primary tenant
- [ ] `ENTRA_CLIENT_ID` matches app registration
- [ ] `ENTRA_CLIENT_SECRET` is valid and not expired
- [ ] `ENTRA_AUDIENCE` set to `api://` style URI (not just GUID)
- [ ] `ENTRA_TRUSTED_TENANT_IDS` OR `ENTRA_ALLOW_ANY_TENANT` configured

### ✅ Entra App Registration
- [ ] Supported account types = Multitenant
- [ ] Application ID URI configured
- [ ] Redirect URIs include `oauth.botframework.com/callback`
- [ ] API permissions include `access_as_user` scope
- [ ] `requestedAccessTokenVersion = 2`
- [ ] User consent strings populated

### ✅ Remote Tenant (Copilot Studio)
- [ ] Admin from remote tenant granted consent
- [ ] Enterprise Applications shows app with "Granted" status
- [ ] User account can sign in with Copilot Studio

### ✅ OIDC Discovery
- [ ] GET `/.well-known/openid-configuration` returns 200
- [ ] Response includes correct `issuer`, `authorization_endpoint`, `token_endpoint`
- [ ] Scopes include `api://APPLICATION_ID/access_as_user`

### ✅ DCR (Dynamic Client Registration)
- [ ] POST `/oauth/register` returns 201
- [ ] Response includes `client_id`, `client_secret`, `scope`

---

## Architecture Diagram

```
┌─────────────────────────────────┐         ┌───────────────────────────────┐
│       Primary Tenant (A)        │         │      Remote Tenant (B)        │
│                                  │         │   (Copilot Studio)             │
├─────────────────────────────────┤         ├───────────────────────────────┤
│  ┌──────────────────────────┐   │         │  ┌─────────────────────────┐ │
│  │  Azure Function          │   │         │  │  Copilot Studio         │ │
│  │  (MCP Server)            │   │         │  │  (OAuth Client)         │ │
│  │                          │   │         │  │                         │ │
│  │  /.well-known/...─────────────────────────│  1. Fetch metadata      │ │
│  │  /oauth/register─────────────────────────│  2. Register client     │ │
│  │  /mcp ───────────────────────────────────│  3. Obtain token (Tenant B)
│  │                          │   │         │  │                         │ │
│  └──────────────────────────┘   │         │  └────────────────────────│─ │
│         ↓                        │         │         ↓                   │ │
│  ┌──────────────────────────┐   │         │  POST token to /mcp         │ │
│  │  Entra App Registration  │   │         │  (with Bearer token)        │ │
│  │  Multitenant             │   │         │                             │ │
│  └──────────────────────────┘   │         │  Admin Consent (pre-req)    │ │
│         ↓                        │         │                             │ │
│  ┌──────────────────────────┐   │         │                             │ │
│  │  ENTRA_TENANT_ID         │   │         │                             │ │
│  │  ENTRA_CLIENT_ID         │   │         │                             │ │
│  │  ENTRA_TRUSTED_TENANT_IDS│───────────────│─→ Token validation checks   │ │
│  └──────────────────────────┘   │         │                             │ │
└─────────────────────────────────┘         └───────────────────────────────┘
```

---

## Related Files

- [src/config.ts](src/config.ts) - Configuration loading
- [src/services/entraTokenValidator.ts](src/services/entraTokenValidator.ts) - Token validation logic
- [src/app.ts](src/app.ts) - Middleware that enforces Bearer token validation
- [.azure/dev/.env](.azure/dev/.env) - Environment variable templates

---

## Support & Questions

For issues or questions about cross-tenant OAuth setup:
1. Check Azure Application Insights for Bearer token validation errors
2. Verify OIDC discovery and DCR endpoints return expected data
3. Confirm Entra app registration settings match checklist above
4. Test by creating a new Copilot Studio connector with updated OIDC endpoint
