import { app, HttpRequest, HttpResponseInit, InvocationContext } from "@azure/functions";
import axios from "axios";
import crypto from "node:crypto";
import { config } from "../config";

/**
 * OAuth 2.0 Dynamic Discovery endpoints that enable Copilot Studio's
 * "OAuth 2.0 → Dynamic discovery" MCP authentication type.
 *
 * Two endpoints are exposed:
 *
 *   GET  /.well-known/openid-configuration
 *        OpenID Connect Discovery document pointing at the Entra tenant's
 *        authorization and token endpoints.  Includes a `registration_endpoint`
 *        so Copilot Studio can use Dynamic Client Registration (DCR, RFC 7591).
 *        Falls back gracefully (404) when Entra auth is not configured.
 *        The issuer and endpoint URLs are proxied from Microsoft's real OIDC
 *        discovery document so they stay accurate even when ENTRA_TENANT_ID is
 *        configured as a domain rather than a GUID.
 *        When ENTRA_TRUSTED_TENANT_IDS or ENTRA_ALLOW_ANY_TENANT is set, the
 *        authorization and token endpoints use the /common/ tenant so that users
 *        from any Entra tenant can authenticate (cross-tenant support).
 *
 *   POST /oauth/register
 *        RFC 7591 Dynamic Client Registration endpoint.  Returns the
 *        pre-registered Entra application credentials (client_id + client_secret)
 *        so Copilot Studio's wizard can complete OAuth setup automatically.
 *        Returns 404 when ENTRA_CLIENT_SECRET is not configured (the "Dynamic"
 *        or "Manual" Copilot Studio auth types can be used instead).
 *
 *        SECURITY NOTE: This endpoint is unauthenticated by design when no
 *        initial access token is configured — RFC 7591 DCR allows clients to
 *        register without prior credentials.  To restrict access, set
 *        ENTRA_DCR_REGISTRATION_TOKEN to a strong random secret; the endpoint
 *        will then require "Authorization: Bearer <token>" before returning
 *        credentials.  If Copilot Studio's automated DCR call supports sending
 *        custom auth headers, configure it to include the token.  Alternatively,
 *        protect the Function App at the network level (VNet integration /
 *        Private Endpoints), or clear ENTRA_CLIENT_SECRET to disable DCR
 *        entirely and use the "Dynamic" or "Manual" wizard option instead.
 *
 * CORS: All endpoints include Access-Control-Allow-Origin: * headers and handle
 * OPTIONS preflight requests so that browser-based clients (including Copilot
 * Studio) can reach them from any origin without being blocked.
 */

const OIDC_CACHE_MAX_AGE_SECONDS = 3600; // 1 hour
const MS_METADATA_CACHE_TTL_MS = OIDC_CACHE_MAX_AGE_SECONDS * 1_000;

// CORS headers included on every OIDC response so that browser-based clients
// (including Microsoft Copilot Studio) can reach these endpoints cross-origin.
const CORS_HEADERS: Record<string, string> = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization"
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

interface MsOidcMetadata {
  issuer?: string;
  authorization_endpoint?: string;
  token_endpoint?: string;
  jwks_uri?: string;
}

interface MsMetadataCache {
  metadata: MsOidcMetadata;
  expiresAtMs: number;
}

// Module-level cache so repeated discovery requests reuse the same metadata.
const msMetadataCache = new Map<string, MsMetadataCache>();

/**
 * Fetches real endpoint URLs from Microsoft's OIDC discovery document so the
 * issuer in our discovery doc matches the iss claim in actual tokens — which is
 * always GUID-based even when ENTRA_TENANT_ID is configured as a domain.
 * Results are cached for OIDC_CACHE_MAX_AGE_SECONDS to avoid repeated fetches.
 * Falls back to an empty object on fetch failure.
 */
async function fetchMsOidcMetadata(tenantId: string): Promise<MsOidcMetadata> {
  const now = Date.now();
  const cached = msMetadataCache.get(tenantId);
  if (cached && now < cached.expiresAtMs) {
    return cached.metadata;
  }

  const metadataUrl = `https://login.microsoftonline.com/${tenantId}/v2.0/.well-known/openid-configuration`;
  try {
    const { data } = await axios.get<MsOidcMetadata>(metadataUrl, { timeout: 5_000 });
    msMetadataCache.set(tenantId, { metadata: data, expiresAtMs: now + MS_METADATA_CACHE_TTL_MS });
    return data;
  } catch {
    return {};
  }
}

// ---------------------------------------------------------------------------
// /.well-known/openid-configuration
// ---------------------------------------------------------------------------

async function oidcDiscoveryHandler(
  request: HttpRequest,
  _context: InvocationContext
): Promise<HttpResponseInit> {
  const { tenantId, clientId } = config.entraAuth;

  if (!tenantId || !clientId) {
    return {
      status: 404,
      headers: { "Content-Type": "application/json", ...CORS_HEADERS },
      body: JSON.stringify({ error: "Entra ID is not configured on this server" })
    };
  }

  // Derive the base URL of this server from the incoming request so the
  // registration_endpoint URL is correct regardless of deployment host.
  const requestUrl = new URL(request.url);
  const serverBase = `${requestUrl.protocol}//${requestUrl.host}`;

  // Fetch real metadata from Microsoft so our issuer/endpoint values exactly
  // match what Entra emits in tokens (which use the tenant GUID, not a domain).
  const msMetadata = await fetchMsOidcMetadata(tenantId);
  const issuerBase =
    msMetadata.issuer ??
    `https://login.microsoftonline.com/${tenantId}/v2.0`;

  // For cross-tenant scenarios (Copilot Studio in a different Entra tenant), the
  // authorization and token endpoints must use the /common/ path so that users
  // from any Microsoft tenant can authenticate.  When no cross-tenant config is
  // present, use the primary tenant's endpoints from Microsoft's discovery doc.
  const isCrossTenant =
    config.entraAuth.allowAnyTenant ||
    (config.entraAuth.trustedTenantIds?.length ?? 0) > 0;

  const authorizationEndpoint = isCrossTenant
    ? "https://login.microsoftonline.com/common/oauth2/v2.0/authorize"
    : (msMetadata.authorization_endpoint ??
        `https://login.microsoftonline.com/${tenantId}/oauth2/v2.0/authorize`);

  const tokenEndpoint = isCrossTenant
    ? "https://login.microsoftonline.com/common/oauth2/v2.0/token"
    : (msMetadata.token_endpoint ??
        `https://login.microsoftonline.com/${tenantId}/oauth2/v2.0/token`);

  const jwksUri =
    msMetadata.jwks_uri ??
    `https://login.microsoftonline.com/${tenantId}/discovery/v2.0/keys`;

  const discoveryDoc = {
    issuer: issuerBase,
    authorization_endpoint: authorizationEndpoint,
    token_endpoint: tokenEndpoint,
    token_endpoint_auth_methods_supported: ["client_secret_post", "client_secret_basic"],
    jwks_uri: jwksUri,
    userinfo_endpoint: "https://graph.microsoft.com/oidc/userinfo",
    // DCR endpoint: present only when the client secret is configured
    ...(config.entraAuth.clientSecret
      ? { registration_endpoint: `${serverBase}/oauth/register` }
      : {}),
    scopes_supported: [
      `api://${clientId}/access_as_user`,
      "openid", "profile", "email", "offline_access"
    ],
    response_types_supported: ["code"],
    response_modes_supported: ["query", "fragment"],
    grant_types_supported: ["authorization_code", "refresh_token"],
    code_challenge_methods_supported: ["S256"],
    subject_types_supported: ["pairwise"],
    id_token_signing_alg_values_supported: ["RS256"],
    claims_supported: [
      "sub", "iss", "aud", "exp", "iat", "auth_time",
      "oid", "tid", "name", "preferred_username", "email"
    ]
  };

  return {
    status: 200,
    headers: {
      "Content-Type": "application/json",
      // Allow browsers / clients to cache the discovery document.
      "Cache-Control": `public, max-age=${OIDC_CACHE_MAX_AGE_SECONDS}`,
      ...CORS_HEADERS
    },
    body: JSON.stringify(discoveryDoc)
  };
}

app.http("oidc-discovery", {
  methods: ["GET"],
  authLevel: "anonymous",
  route: ".well-known/openid-configuration",
  handler: oidcDiscoveryHandler
});

// CORS preflight for the OIDC discovery endpoint.
app.http("oidc-discovery-options", {
  methods: ["OPTIONS"],
  authLevel: "anonymous",
  route: ".well-known/openid-configuration",
  handler: async (): Promise<HttpResponseInit> => ({
    status: 204,
    headers: CORS_HEADERS
  })
});

// ---------------------------------------------------------------------------
// /oauth/register  — RFC 7591 Dynamic Client Registration
// ---------------------------------------------------------------------------

async function oauthRegisterHandler(
  request: HttpRequest,
  _context: InvocationContext
): Promise<HttpResponseInit> {
  const { clientId, clientSecret, dcrRegistrationToken } = config.entraAuth;

  if (!clientId || !clientSecret) {
    return {
      status: 404,
      headers: { "Content-Type": "application/json", ...CORS_HEADERS },
      body: JSON.stringify({
        error: "invalid_client_metadata",
        error_description:
          "Dynamic Client Registration is not enabled on this server. " +
          "Use 'Dynamic' or 'Manual' OAuth type in Copilot Studio and provide " +
          "the Entra application credentials manually."
      })
    };
  }

  // When ENTRA_DCR_REGISTRATION_TOKEN is configured, require an RFC 7591
  // initial access token in the Authorization header before returning credentials.
  // Use constant-time comparison to prevent timing-based token inference.
  if (dcrRegistrationToken) {
    const authHeader = request.headers.get("authorization") ?? "";
    const presentedToken = authHeader.startsWith("Bearer ") ? authHeader.slice(7) : "";
    const expected = Buffer.from(dcrRegistrationToken, "utf8");
    const presented = Buffer.from(presentedToken, "utf8");
    const tokenValid =
      expected.length === presented.length &&
      crypto.timingSafeEqual(expected, presented);
    if (!tokenValid) {
      return {
        status: 401,
        headers: {
          "Content-Type": "application/json",
          "WWW-Authenticate": 'Bearer realm="oauth-register"',
          ...CORS_HEADERS
        },
        body: JSON.stringify({
          error: "unauthorized",
          error_description:
            "A valid registration access token is required. " +
            "Set ENTRA_DCR_REGISTRATION_TOKEN and pass it as 'Authorization: Bearer <token>'."
        })
      };
    }
  }

  // Return the pre-registered Entra application credentials.
  // Copilot Studio stores these and uses them for the Authorization Code flow.
  const registrationResponse = {
    client_id: clientId,
    client_secret: clientSecret,
    client_id_issued_at: Math.floor(Date.now() / 1_000),
    // 0 = non-expiring (the Entra app registration controls the actual lifetime)
    client_secret_expires_at: 0,
    grant_types: ["authorization_code", "refresh_token"],
    response_types: ["code"],
    token_endpoint_auth_method: "client_secret_post",
    scope: `api://${clientId}/access_as_user openid profile email offline_access`
  };

  return {
    status: 201,
    headers: { "Content-Type": "application/json", ...CORS_HEADERS },
    body: JSON.stringify(registrationResponse)
  };
}

app.http("oauth-register", {
  methods: ["POST"],
  authLevel: "anonymous",
  route: "oauth/register",
  handler: oauthRegisterHandler
});

// CORS preflight for the DCR endpoint.
app.http("oauth-register-options", {
  methods: ["OPTIONS"],
  authLevel: "anonymous",
  route: "oauth/register",
  handler: async (): Promise<HttpResponseInit> => ({
    status: 204,
    headers: CORS_HEADERS
  })
});
