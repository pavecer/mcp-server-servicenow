function getRequiredEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value;
}

export const config = {
  serviceNow: {
    instanceUrl: getRequiredEnv("SERVICENOW_INSTANCE_URL"),
    clientId: getRequiredEnv("SERVICENOW_CLIENT_ID"),
    clientSecret: getRequiredEnv("SERVICENOW_CLIENT_SECRET"),
    username: process.env.SERVICENOW_USERNAME,
    password: process.env.SERVICENOW_PASSWORD,
    tokenPath: process.env.SERVICENOW_OAUTH_TOKEN_PATH || "/oauth_token.do",
    tokenAuthStyle: process.env.SERVICENOW_OAUTH_CLIENT_AUTH_STYLE || "auto",
    grantType: process.env.SERVICENOW_OAUTH_GRANT_TYPE || "auto"
  },

  // Microsoft Entra ID (Azure AD) OAuth 2.0 settings.
  // When ENTRA_TENANT_ID and ENTRA_CLIENT_ID are set the MCP endpoint requires
  // a valid Entra Bearer token on every request. Set ENTRA_AUTH_DISABLED=true
  // to skip validation during local development.
  //
  // For cross-tenant scenarios (Copilot Studio in different tenant than Azure Function):
  // - Sets Entra app to multi-tenant (signInAudience: AzureADMultipleOrgs) in portal
  // - Obtain admin consent in remote tenant
  // - Set ENTRA_TRUSTED_TENANT_IDS to comma-separated list of allowed remote tenant GUIDs
  // - Or set ENTRA_ALLOW_ANY_TENANT=true to accept any Microsoft tenant (use with caution)
  entraAuth: {
    tenantId: process.env.ENTRA_TENANT_ID,
    clientId: process.env.ENTRA_CLIENT_ID,
    // Used in the DCR response so Copilot Studio can use the auth code flow.
    clientSecret: process.env.ENTRA_CLIENT_SECRET,
    // Optional RFC 7591 "initial access token" that must be presented as
    // "Authorization: Bearer <token>" when calling POST /oauth/register.
    // When unset the endpoint is open (required for automated Copilot Studio DCR).
    dcrRegistrationToken: process.env.ENTRA_DCR_REGISTRATION_TOKEN,
    // Expected audience in the Bearer token. Defaults to the Entra client ID.
    // Override to "api://<clientId>" when the app exposes a custom App ID URI.
    audience: process.env.ENTRA_AUDIENCE,
    // Space-delimited OAuth scopes advertised in OIDC discovery and DCR output.
    // Must contain delegated scopes (v2 style) and should include offline_access
    // to allow stable refresh token behavior in Power Platform connectors.
    // Example: "openid profile offline_access User.Read"
    oauthScopes: process.env.ENTRA_OAUTH_SCOPES,
    // Set to "true" to bypass Bearer token validation (local dev / smoke tests).
    disabled: process.env.ENTRA_AUTH_DISABLED === "true",
    // For cross-tenant scenarios: comma-separated list of trusted remote tenant GUIDs
    // Tokens from these tenants will be accepted. Empty/unset = only primary tenant.
    trustedTenantIds: process.env.ENTRA_TRUSTED_TENANT_IDS
      ? process.env.ENTRA_TRUSTED_TENANT_IDS.split(",").map(t => t.trim()).filter(Boolean)
      : [],
    // For cross-tenant scenarios: set to "true" to accept tokens from ANY Microsoft tenant.
    // ⚠️  Use caution: this creates an open OAuth endpoint. Verify via audience validation
    // and request identifiers that the caller is authorized before giving access to data.
    allowAnyTenant: process.env.ENTRA_ALLOW_ANY_TENANT === "true",
    // Additional accepted audience values beyond the auto-derived GUID and api://<clientId>.
    // Comma-separated list. Use when your app has a custom App ID URI or non-standard audience.
    allowedAudiences: process.env.ENTRA_ALLOWED_AUDIENCES
      ? process.env.ENTRA_ALLOWED_AUDIENCES.split(",").map(a => a.trim()).filter(Boolean)
      : []
  }
};
