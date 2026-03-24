# Multi-Tenant Token Validation - Implementation Guide

## Summary of Changes

This document describes the implementation of **multi-tenant OAuth 2.0 support** in the ServiceNow MCP server's token validation layer.

### What Changed

The token validator now supports:
1. **Single-tenant validation** (original behavior): Accept tokens only from the configured primary tenant
2. **Trusted multi-tenant validation**: Accept tokens from specific remote tenants
3. **Any-tenant validation** (permissive): Accept tokens from any Microsoft tenant

---

## Configuration

### Environment Variables (New)

**`.azure/dev/.env`**:
```env
# Existing variables
ENTRA_TENANT_ID=1938ee32-a258-454c-b8db-3a928341bd69
ENTRA_CLIENT_ID=44b3a088-05e3-4fcc-9216-d1b117ed489a
ENTRA_CLIENT_SECRET=...
ENTRA_AUDIENCE=api://44b3a088-05e3-4fcc-9216-d1b117ed489a

# New: Trusted remote tenant IDs (comma-separated GUIDs)
ENTRA_TRUSTED_TENANT_IDS=f8cdef31-a31b-4234-b2be-1234567890ab,a1234567-b890-cdef-1234-567890abcdef

# New: Accept any Microsoft tenant (use with caution)
ENTRA_ALLOW_ANY_TENANT=false
```

### Code Changes

#### 1. [src/config.ts](src/config.ts)

**Added**:
```typescript
entraAuth: {
  // ... existing properties ...
  
  // New: Trusted remote tenant GUIDs
  trustedTenantIds: process.env.ENTRA_TRUSTED_TENANT_IDS
    ? process.env.ENTRA_TRUSTED_TENANT_IDS.split(",").map(t => t.trim()).filter(Boolean)
    : [],
  
  // New: Accept any Microsoft tenant
  allowAnyTenant: process.env.ENTRA_ALLOW_ANY_TENANT === "true"
}
```

**Rationale**:
- Parses comma-separated list into array for validation logic
- Safely handles missing/empty values
- Provides configuration control over trust model

---

#### 2. [src/services/entraTokenValidator.ts](src/services/entraTokenValidator.ts)

**Function Signature Change**:

```typescript
// OLD
export async function validateEntraToken(
  bearerToken: string,
  tenantId: string,
  acceptedAudiences: Set<string>
): Promise<EntraTokenPayload>

// NEW
export async function validateEntraToken(
  bearerToken: string,
  primaryTenantId: string,
  acceptedAudiences: Set<string>,
  trustedTenantIds: string[] = [],
  allowAnyTenant: boolean = false
): Promise<EntraTokenPayload>
```

**New Validation Logic** (early in function):

```typescript
// Extract tenant ID from token's tid claim (tells us which tenant issued the token)
const tokenTenantId = payload.tid;
if (!tokenTenantId || typeof tokenTenantId !== "string") {
  throw new Error("Missing or invalid tenant ID (tid) claim in token");
}

// Validate tenant: must be primary tenant, a trusted tenant, or any tenant if allowed
const isTrustedTenant = tokenTenantId === primaryTenantId ||
  trustedTenantIds.includes(tokenTenantId);

if (!isTrustedTenant && !allowAnyTenant) {
  throw new Error(
    `Token issued by untrusted tenant ${tokenTenantId}. ` +
    `Primary tenant: ${primaryTenantId}, ` +
    `Trusted tenants: [${trustedTenantIds.join(", ")}]`
  );
}
```

**Updated JWKS Endpoint**:

```typescript
// OLD: Used configured tenant ID
const jwksUri = `https://login.microsoftonline.com/${tenantId}/discovery/v2.0/keys`;

// NEW: Uses tenant from token (supports cross-tenant)
const jwksUri = `https://login.microsoftonline.com/${tokenTenantId}/discovery/v2.0/keys`;
```

**Simplified Issuer Validation**:

```typescript
// OLD: Checked if issuer matches configured tenant OR token's tid
if (
  !issuerHostValid ||
  !issuerVersionValid ||
  !(issuerTenantMatchesConfig || issuerTenantMatchesTid)
) {
  throw new Error("Invalid issuer");
}

// NEW: Only checks if issuer matches token's tid (already validated as trusted)
const issuerTenantMatchesTid = issuerTenant === tokenTenantId;

if (!issuerHostValid || !issuerVersionValid || !issuerTenantMatchesTid) {
  throw new Error("Invalid issuer");
}
```

**Rationale**:
- Early tenant validation prevents unnecessary processing
- Clear error messages for debugging
- JWKS endpoint keyed by token's issuing tenant (required for cross-tenant)
- Issuer validation simplified because tenant trust already established

---

#### 3. [src/app.ts](src/app.ts)

**Middleware Update**:

```typescript
// Pass additional parameters to validator
const payload = await validateEntraToken(
  token,
  entra.tenantId,
  acceptedAudiences,
  entra.trustedTenantIds,      // NEW
  entra.allowAnyTenant           // NEW
);
```

**Additional MCP OAuth compatibility behavior**:

```typescript
// Unauthenticated POST /mcp returns 401 with WWW-Authenticate
// including resource_metadata so Copilot Studio / Power Platform
// can discover the authorization server correctly.
res
  .status(401)
  .set("WWW-Authenticate", `Bearer realm="${req.protocol}://${req.get("host")}/mcp", resource_metadata="${resourceMetadataUrl}"`)
```

This repo also exposes:
- `/.well-known/openid-configuration`
- `/.well-known/oauth-authorization-server`
- `/.well-known/oauth-protected-resource`

These endpoints were required for Copilot Studio's OAuth flow to work reliably through the Power Platform consent proxy.

---

## Validation Flow (Sequence)

```
Token Received (Bearer header)
    ↓
[1] JWT Structure Validation
    - Split on dots, validate 3 parts
    ↓
[2] Header/Payload Decode
    - Base64URL decode
    - Extract alg, kid (header) and aud, oid, tid, iss, exp, nbf (payload)
    ↓
[3] Algorithm Validation
    - Must be RS256
    ↓
[4] Kid Present
    - Header must have 'kid' (key ID for signature verification)
    ↓
[5] ⭐ NEW: Tenant Validation (Multi-Tenant)
    - Extract tokenTenantId = payload.tid
    - Check if tid in primaryTenantId OR trustedTenantIds OR allowAnyTenant
    - FAIL if untrusted AND not allowAnyTenant
    ↓
[6] Signature Verification (Cross-Tenant Support)
    - Fetch JWKS from Microsoft for tokenTenantId (not primary tenant!)
    - Verify RS256 signature
    ↓
[7] Time-Based Claims
    - Validate exp (not expired)
    - Validate nbf (not yet valid, with 5min skew)
    ↓
[8] Issuer Validation
    - Parse issuer URL
    - Validate host (login.microsoftonline.com or sts.windows.net)
    - Validate version (/v2.0)
    - Validate tenant in path matches tokenTenantId
    ↓
[9] Audience Validation
    - At least one aud claim must be in acceptedAudiences set
    ↓
SUCCESS: Return EntraTokenPayload
```

---

## Backward Compatibility

✅ **Fully backward compatible**:
- Old code passing only 3 parameters still works (new params have defaults)
- `trustedTenantIds = []` (empty array)
- `allowAnyTenant = false` (false by default)
- Single-tenant behavior unchanged when new env vars not set

**Example (old code still works)**:
```typescript
// This call still works with new function
const payload = await validateEntraToken(token, "my-tenant-id", audiences);

// Equivalent to:
const payload = await validateEntraToken(token, "my-tenant-id", audiences, [], false);
```

---

## Security Considerations

### 1. **Audience Validation is Critical**

Even with `allowAnyTenant=true`, the token must contain one of the expected audiences:
```typescript
const acceptedAudiences = buildAcceptedAudiences(clientId, audienceOverride);
// Contains: { clientId, `api://${clientId}`, audienceOverride (if provided) }
```

This means:
- Tokens for different app registrations are rejected
- Only tokens targeting THIS MCP server are accepted

### 2. **Tenant ID Extraction from `tid` Claim**

The `tid` claim comes from the token issuer (Microsoft Entra). This is:
- ✅ Cryptographically signed (part of JWT payload)
- ✅ Validated against JWKS signature
- ✅ Cannot be spoofed without valid private key

### 3. **Signature Verification is Per-Tenant**

Each tenant has its own JWKS endpoint. By fetching JWKS from `login.microsoftonline.com/{tid}/...`:
- ✅ Only valid tokens from trusted tenants are accepted
- ✅ Private keys from other tenants cannot verify signatures

### 4. **Recommended Configurations**

**Production** (explicit allow-list):
```env
ENTRA_TRUSTED_TENANT_IDS=f8cdef31-a31b-4234-b2be-1234567890ab,a1234567-b890-cdef-1234-567890abcdef
ENTRA_ALLOW_ANY_TENANT=false  # Explicit, not implicit
```

**Development** (permissive):
```env
ENTRA_ALLOW_ANY_TENANT=true
# Combined with audience + signature validation still provides protection
```

**Avoid** (not recommended):
```env
# Not recommended in production, but works:
export ENTRA_AUTH_DISABLED=true
```

---

## Testing

### Unit Test Scenario 1: Trusted Remote Tenant

```typescript
const token = createJwt({
  tid: "f8cdef31-a31b-4234-b2be-1234567890ab",  // Remote tenant
  aud: "api://44b3a088-05e3-4fcc-9216-d1b117ed489a",
  iss: "https://login.microsoftonline.com/f8cdef31-a31b-4234-b2be-1234567890ab/v2.0",
  oid: "user-obj-id",
  exp: futureTimestamp
});

const result = await validateEntraToken(
  token,
  "1938ee32-a258-454c-b8db-3a928341bd69",  // Primary tenant
  audiences,
  ["f8cdef31-a31b-4234-b2be-1234567890ab"],  // Trusted
  false
);

// ✅ Should succeed
expect(result.tid).toBe("f8cdef31-a31b-4234-b2be-1234567890ab");
```

### Unit Test Scenario 2: Untrusted Remote Tenant

```typescript
const token = createJwt({
  tid: "untrusted-tenant-guid",
  aud: "api://44b3a088-05e3-4fcc-9216-d1b117ed489a",
  iss: "https://login.microsoftonline.com/untrusted-tenant-guid/v2.0",
  oid: "user-obj-id",
  exp: futureTimestamp
});

const result = await validateEntraToken(
  token,
  "1938ee32-a258-454c-b8db-3a928341bd69",  // Primary
  audiences,
  [],  // Empty trusted list
  false
);

// ❌ Should throw "Token issued by untrusted tenant"
expect(result).toThrow(/Token issued by untrusted tenant/);
```

### Unit Test Scenario 3: Any-Tenant Allow

```typescript
const token = createJwt({
  tid: "any-random-tenant-guid",
  aud: "api://44b3a088-05e3-4fcc-9216-d1b117ed489a",
  iss: "https://login.microsoftonline.com/any-random-tenant-guid/v2.0",
  oid: "user-obj-id",
  exp: futureTimestamp
});

const result = await validateEntraToken(
  token,
  "1938ee32-a258-454c-b8db-3a928341bd69",
  audiences,
  [],
  true  // allowAnyTenant
);

// ✅ Should succeed (audience still validated)
expect(result.tid).toBe("any-random-tenant-guid");
```

---

## Performance Impact

- **No additional latency**: Tenant check happens before expensive operations (sig verify)
- **JWKS caching still applies**: Each tenant's JWKS cached for 1 hour
- **Benefit**: Failed calls fail fast (untrusted tenants rejected immediately)

---

## Migration Path (Single-Tenant → Multi-Tenant)

### Step 1: Deploy code (this PR)
```bash
npm run build && azd deploy
```

### Step 2: Enable in portal
- Update Entra app → **Authentication** → **Supported account types** = Multitenant
- Save

### Step 3: Configure environment
```bash
azd env set ENTRA_TRUSTED_TENANT_IDS "f8cdef31-a31b-4234-b2be-1234567890ab"
azd deploy  # Redeploy to apply settings
```

### Step 4: Remote tenant admin consent
- Admin from remote tenant visits admin consent URL (see setup guide)

### Step 5: Test
- Create new Copilot Studio connector
- Test OAuth flow

---

## Files Modified

| File | Change |
|------|--------|
| [src/config.ts](src/config.ts) | Added `trustedTenantIds` and `allowAnyTenant` config props |
| [src/services/entraTokenValidator.ts](src/services/entraTokenValidator.ts) | Updated function signature, added tenant validation, updated JWKS endpoint |
| [src/app.ts](src/app.ts) | Pass new parameters to `validateEntraToken()` |
| [.azure/dev/.env](.azure/dev/.env) | Added `ENTRA_TRUSTED_TENANT_IDS` and `ENTRA_ALLOW_ANY_TENANT` |

---

## References

- [Cross-Tenant OAuth Setup Guide](CROSS_TENANT_OAUTH_SETUP.md)
- [Microsoft Entra v2.0 Endpoint](https://learn.microsoft.com/en-us/entra/identity-platform/v2-overview)
- [OIDC Discovery Spec](https://openid.net/specs/openid-connect-discovery-1_0.html)
- [RFC 8414: OAuth 2.0 Authorization Server Metadata](https://tools.ietf.org/html/rfc8414)
