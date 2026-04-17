import axios from "axios";
import { config } from "../config";

interface OAuthTokenResponse {
  access_token: string;
  token_type: string;
  expires_in: number;
}

interface CachedToken {
  value: string;
  expiresAtEpochMs: number;
}

type TokenAuthStyle = "auto" | "request_body" | "basic";
type GrantType = "auto" | "password" | "client_credentials";

export class TokenManager {
  private cachedToken?: CachedToken;

  private formatTokenRequestError(error: unknown): string {
    if (!axios.isAxiosError(error)) {
      return error instanceof Error ? error.message : "unknown token request error";
    }

    const status = error.response?.status;
    const statusText = error.response?.statusText;
    const responseData = error.response?.data;
    const oauthError = typeof responseData === "object" && responseData !== null
      ? (responseData as Record<string, unknown>).error
      : undefined;
    const oauthDescription = typeof responseData === "object" && responseData !== null
      ? (responseData as Record<string, unknown>).error_description
      : undefined;

    const oauthBits = [oauthError, oauthDescription]
      .filter((v): v is string => typeof v === "string" && v.trim().length > 0)
      .join(": ");

    if (status) {
      return oauthBits
        ? `HTTP ${status}${statusText ? ` ${statusText}` : ""} (${oauthBits})`
        : `HTTP ${status}${statusText ? ` ${statusText}` : ""}`;
    }

    return oauthBits || error.message || "request failed without response";
  }

  async getAccessToken(): Promise<string> {
    if (this.cachedToken && Date.now() < this.cachedToken.expiresAtEpochMs) {
      return this.cachedToken.value;
    }

    const tokenUrl = new URL(config.serviceNow.tokenPath, config.serviceNow.instanceUrl).toString();
    const configuredGrant = (config.serviceNow.grantType || "auto") as GrantType;
    const hasCredentials = !!(config.serviceNow.username && config.serviceNow.password);

    // Determine which grant type(s) to try.
    // "auto": prefer password grant when username/password are provided (works with the
    //         standard ServiceNow App Registry without any extra system properties);
    //         fall back to client_credentials otherwise.
    const grantsToTry: Array<Exclude<GrantType, "auto">> =
      configuredGrant === "password"
        ? ["password"]
        : configuredGrant === "client_credentials"
          ? ["client_credentials"]
          : hasCredentials
            ? ["password"]
            : ["client_credentials"];

    const configuredStyle = (config.serviceNow.tokenAuthStyle || "auto") as TokenAuthStyle;
    const stylesToTry: Array<Exclude<TokenAuthStyle, "auto">> =
      configuredStyle === "request_body"
        ? ["request_body"]
        : configuredStyle === "basic"
          ? ["basic"]
          : ["request_body", "basic"];

    let response: { data: OAuthTokenResponse } | undefined;
    let lastErrorMessage = "";

    outer: for (const grant of grantsToTry) {
      for (const style of stylesToTry) {
        try {
          response = await this.requestToken(tokenUrl, grant, style);
          break outer;
        } catch (error) {
          lastErrorMessage = `${grant}/${style}: ${this.formatTokenRequestError(error)}`;
        }
      }
    }

    if (!response) {
      throw new Error(
        `Unable to acquire ServiceNow OAuth token after trying configured grant/auth styles. Last failure: ${lastErrorMessage || "unknown error"}`
      );
    }

    const expiresInMs = Math.max(30, response.data.expires_in - 30) * 1000;
    this.cachedToken = {
      value: response.data.access_token,
      expiresAtEpochMs: Date.now() + expiresInMs
    };

    return this.cachedToken.value;
  }

  private async requestToken(
    tokenUrl: string,
    grant: "password" | "client_credentials",
    style: "request_body" | "basic"
  ) {
    const params: Record<string, string> = { grant_type: grant };

    if (grant === "password") {
      if (!config.serviceNow.username || !config.serviceNow.password) {
        throw new Error(
          "SERVICENOW_USERNAME and SERVICENOW_PASSWORD are required for the password grant type"
        );
      }
      params.username = config.serviceNow.username;
      params.password = config.serviceNow.password;
    }

    if (style === "request_body") {
      params.client_id = config.serviceNow.clientId;
      params.client_secret = config.serviceNow.clientSecret;
    }

    const payload = new URLSearchParams(params);

    const headers: Record<string, string> = {
      "Content-Type": "application/x-www-form-urlencoded"
    };

    if (style === "basic") {
      const basic = Buffer.from(
        `${config.serviceNow.clientId}:${config.serviceNow.clientSecret}`
      ).toString("base64");
      headers.Authorization = `Basic ${basic}`;
    }

    return axios.post<OAuthTokenResponse>(tokenUrl, payload.toString(), {
      headers,
      timeout: 10_000
    });
  }
}
