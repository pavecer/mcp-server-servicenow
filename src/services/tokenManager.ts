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

export class TokenManager {
  private cachedToken?: CachedToken;

  async getAccessToken(): Promise<string> {
    if (this.cachedToken && Date.now() < this.cachedToken.expiresAtEpochMs) {
      return this.cachedToken.value;
    }

    const tokenUrl = new URL(config.serviceNow.tokenPath, config.serviceNow.instanceUrl).toString();
    const payload = new URLSearchParams({
      grant_type: "client_credentials",
      client_id: config.serviceNow.clientId,
      client_secret: config.serviceNow.clientSecret
    });

    const response = await axios.post<OAuthTokenResponse>(tokenUrl, payload.toString(), {
      headers: {
        "Content-Type": "application/x-www-form-urlencoded"
      }
    });

    const expiresInMs = Math.max(30, response.data.expires_in - 30) * 1000;
    this.cachedToken = {
      value: response.data.access_token,
      expiresAtEpochMs: Date.now() + expiresInMs
    };

    return this.cachedToken.value;
  }
}
