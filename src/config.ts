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
  entraAuth: {
    tenantId: process.env.ENTRA_TENANT_ID,
    clientId: process.env.ENTRA_CLIENT_ID,
    // Used in the DCR response so Copilot Studio can use the auth code flow.
    clientSecret: process.env.ENTRA_CLIENT_SECRET,
    // Expected audience in the Bearer token. Defaults to the Entra client ID.
    // Override to "api://<clientId>" when the app exposes a custom App ID URI.
    audience: process.env.ENTRA_AUDIENCE,
    // Set to "true" to bypass Bearer token validation (local dev / smoke tests).
    disabled: process.env.ENTRA_AUTH_DISABLED === "true"
  }
};
