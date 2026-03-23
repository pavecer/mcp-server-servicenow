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
    tokenPath: process.env.SERVICENOW_OAUTH_TOKEN_PATH || "/oauth_token.do",
    tokenAuthStyle: process.env.SERVICENOW_OAUTH_CLIENT_AUTH_STYLE || "auto"
  }
};
