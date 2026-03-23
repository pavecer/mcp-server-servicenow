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

export class TokenManager {
  private cachedToken?: CachedToken;

  async getAccessToken(): Promise<string> {
    if (this.cachedToken && Date.now() < this.cachedToken.expiresAtEpochMs) {
      return this.cachedToken.value;
    }

    const tokenUrl = new URL(config.serviceNow.tokenPath, config.serviceNow.instanceUrl).toString();
    const configuredStyle = (config.serviceNow.tokenAuthStyle || "auto") as TokenAuthStyle;
    const stylesToTry: Array<Exclude<TokenAuthStyle, "auto">> =
      configuredStyle === "request_body"
        ? ["request_body"]
        : configuredStyle === "basic"
          ? ["basic"]
          : ["request_body", "basic"];

    let response: { data: OAuthTokenResponse } | undefined;
    let lastError: unknown;

    for (const style of stylesToTry) {
      try {
        response = await this.requestToken(tokenUrl, style);
        break;
      } catch (error) {
        lastError = error;
      }
    }

    if (!response) {
      throw lastError;
    }

    const expiresInMs = Math.max(30, response.data.expires_in - 30) * 1000;
    this.cachedToken = {
      value: response.data.access_token,
      expiresAtEpochMs: Date.now() + expiresInMs
    };

    return this.cachedToken.value;
  }

  private async requestToken(tokenUrl: string, style: "request_body" | "basic") {
    const payload =
      style === "request_body"
        ? new URLSearchParams({
            grant_type: "client_credentials",
            client_id: config.serviceNow.clientId,
            client_secret: config.serviceNow.clientSecret
          })
        : new URLSearchParams({
            grant_type: "client_credentials"
          });

    const headers: Record<string, string> = {
      "Content-Type": "application/x-www-form-urlencoded"
    };

    if (style === "basic") {
      const basic = Buffer.from(`${config.serviceNow.clientId}:${config.serviceNow.clientSecret}`).toString("base64");
      headers.Authorization = `Basic ${basic}`;
    }

    return axios.post<OAuthTokenResponse>(tokenUrl, payload.toString(), { headers });
  }
}
