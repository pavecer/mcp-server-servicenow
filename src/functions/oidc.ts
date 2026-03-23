import { app, HttpRequest, HttpResponseInit, InvocationContext } from "@azure/functions";
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
 *
 *   POST /oauth/register
 *        RFC 7591 Dynamic Client Registration endpoint.  Returns the
 *        pre-registered Entra application credentials (client_id + client_secret)
 *        so Copilot Studio's wizard can complete OAuth setup automatically.
 *        Returns 404 when ENTRA_CLIENT_SECRET is not configured (the "Dynamic"
 *        or "Manual" Copilot Studio auth types can be used instead).
 */

const OIDC_CACHE_MAX_AGE_SECONDS = 3600; // 1 hour

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
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ error: "Entra ID is not configured on this server" })
    };
  }

  // Derive the base URL of this server from the incoming request so the
  // registration_endpoint URL is correct regardless of deployment host.
  const requestUrl = new URL(request.url);
  const serverBase = `${requestUrl.protocol}//${requestUrl.host}`;
  const issuerMetadataUrl = `https://login.microsoftonline.com/${tenantId}/v2.0/.well-known/openid-configuration`;

  // Start with derived defaults, then prefer values from Microsoft's discovery document.
  let issuerBase = `https://login.microsoftonline.com/${tenantId}/v2.0`;
  let authorizationEndpoint = `https://login.microsoftonline.com/${tenantId}/oauth2/v2.0/authorize`;
  let tokenEndpoint = `https://login.microsoftonline.com/${tenantId}/oauth2/v2.0/token`;
  let jwksUri = `https://login.microsoftonline.com/${tenantId}/discovery/v2.0/keys`;

  try {
    const issuerResponse = await fetch(issuerMetadataUrl);
    if (issuerResponse.ok) {
      const issuerConfig = await issuerResponse.json();
      issuerBase = issuerConfig.issuer ?? issuerBase;
      authorizationEndpoint = issuerConfig.authorization_endpoint ?? authorizationEndpoint;
      tokenEndpoint = issuerConfig.token_endpoint ?? tokenEndpoint;
      jwksUri = issuerConfig.jwks_uri ?? jwksUri;
    }
  } catch {
    // If the Microsoft discovery document cannot be fetched, fall back to the derived URLs above.
  }

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
    scopes_supported: ["openid", "profile", "email", "offline_access"],
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
      "Cache-Control": `public, max-age=${OIDC_CACHE_MAX_AGE_SECONDS}`
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

// ---------------------------------------------------------------------------
// /oauth/register  — RFC 7591 Dynamic Client Registration
// ---------------------------------------------------------------------------

async function oauthRegisterHandler(
  _request: HttpRequest,
  _context: InvocationContext
): Promise<HttpResponseInit> {
  const { clientId, clientSecret } = config.entraAuth;

  if (!clientId || !clientSecret) {
    return {
      status: 404,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        error: "invalid_client_metadata",
        error_description:
          "Dynamic Client Registration is not enabled on this server. " +
          "Use 'Dynamic' or 'Manual' OAuth type in Copilot Studio and provide " +
          "the Entra application credentials manually."
      })
    };
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
    token_endpoint_auth_method: "client_secret_post"
  };

  return {
    status: 201,
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(registrationResponse)
  };
}

app.http("oauth-register", {
  methods: ["POST"],
  authLevel: "anonymous",
  route: "oauth/register",
  handler: oauthRegisterHandler
});
