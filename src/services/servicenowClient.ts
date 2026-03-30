import axios, { AxiosInstance } from "axios";
import { config } from "../config";
import { ServiceNowCatalogItem, ServiceNowCatalogItemDetail, ServiceNowOrderResult } from "../types/servicenow";
import { TokenManager } from "./tokenManager";
import { getRequestContext } from "../requestContext";

interface SearchOptions {
  catalogSysId?: string;
  categorySysId?: string;
  limit?: number;
}

interface ServiceNowUserLookupRecord {
  sys_id?: string;
  email?: string;
  user_name?: string;
}

type CallerField = "callerUpn" | "callerEntraObjectId";

export interface PlaceOrderInput {
  quantity?: number;
  requestedFor?: string;
  variables: Record<string, string | number | boolean>;
}

export class ServiceNowClient {
  private readonly tokenManager = new TokenManager();

  private sanitizeSysparmQueryValue(value: string): string {
    // ServiceNow encoded queries use ^ as a delimiter, strip it from user-derived values.
    return value.replace(/\^/g, "").trim();
  }

  private sanitizeSysparmFieldName(value: string): string {
    const trimmed = value.trim();
    return /^[A-Za-z0-9_]+$/.test(trimmed) ? trimmed : "";
  }

  private getCallerValues(): string[] {
    const requestContext = getRequestContext();
    const values: string[] = [];

    for (const fieldName of config.serviceNow.requestedForCallerFields) {
      const candidateField = fieldName as CallerField;
      if (candidateField !== "callerUpn" && candidateField !== "callerEntraObjectId") {
        continue;
      }

      const rawValue = requestContext?.[candidateField];
      if (!rawValue) {
        continue;
      }

      const normalized = this.sanitizeSysparmQueryValue(rawValue);
      if (normalized) {
        values.push(normalized);
      }
    }

    return [...new Set(values)];
  }

  private async resolveRequestedFor(client: AxiosInstance, explicitRequestedFor?: string): Promise<string | undefined> {
    const requestedFor = explicitRequestedFor?.trim();
    if (requestedFor) {
      return requestedFor;
    }

    const callerValues = this.getCallerValues();
    if (callerValues.length === 0) {
      return undefined;
    }

    const lookupFields = config.serviceNow.requestedForLookupFields
      .map(field => this.sanitizeSysparmFieldName(field))
      .filter(Boolean);

    if (lookupFields.length > 0) {
      const lookupClauses: string[] = [];
      for (const callerValue of callerValues) {
        for (const field of lookupFields) {
          lookupClauses.push(`${field}=${callerValue}`);
        }
      }

      if (lookupClauses.length > 0) {
        const sysparmQuery = `active=true^${lookupClauses.join("^OR")}`;

        try {
          const response = await client.get<{ result: ServiceNowUserLookupRecord[] }>("/api/now/table/sys_user", {
            params: {
              sysparm_query: sysparmQuery,
              sysparm_fields: "sys_id,email,user_name",
              sysparm_limit: 1
            }
          });

          const resolvedSysId = response.data.result?.[0]?.sys_id;
          if (resolvedSysId) {
            return resolvedSysId;
          }
        } catch {
          // Fall through to caller value fallback.
        }
      }
    }

    if (!config.serviceNow.requestedForFallbackToCallerValue) {
      return undefined;
    }

    // Use first configured caller value (for example callerUpn) when lookup does not resolve.
    return callerValues[0];
  }

  private async getClient(): Promise<AxiosInstance> {
    const callerToken = getRequestContext()?.serviceNowAccessToken;
    const token = callerToken || await this.tokenManager.getAccessToken();

    return axios.create({
      baseURL: config.serviceNow.instanceUrl,
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: "application/json",
        "Content-Type": "application/json"
      },
      timeout: 20000
    });
  }

  async searchCatalogItems(text: string, options?: SearchOptions): Promise<ServiceNowCatalogItem[]> {
    const client = await this.getClient();

    const params: Record<string, string | number> = {
      sysparm_text: text,
      sysparm_limit: options?.limit ?? 20
    };

    if (options?.catalogSysId) {
      params.sysparm_catalog = options.catalogSysId;
    }

    if (options?.categorySysId) {
      params.sysparm_category = options.categorySysId;
    }

    const response = await client.get<{ result: ServiceNowCatalogItem[] }>("/api/sn_sc/servicecatalog/items", {
      params
    });

    return response.data.result || [];
  }

  async getCatalogItem(itemSysId: string): Promise<ServiceNowCatalogItemDetail> {
    const client = await this.getClient();
    const response = await client.get<{ result: ServiceNowCatalogItemDetail }>(
      `/api/sn_sc/servicecatalog/items/${itemSysId}`,
      { params: { sysparm_expand_variables: "true" } }
    );
    return response.data.result;
  }

  async placeOrder(itemSysId: string, input: PlaceOrderInput): Promise<ServiceNowOrderResult> {
    const client = await this.getClient();
    const resolvedRequestedFor = await this.resolveRequestedFor(client, input.requestedFor);

    const payload: Record<string, unknown> = {
      sysparm_quantity: input.quantity ?? 1,
      variables: input.variables
    };

    if (resolvedRequestedFor) {
      payload.sysparm_requested_for = resolvedRequestedFor;
    }

    const response = await client.post<{ result: ServiceNowOrderResult }>(
      `/api/sn_sc/servicecatalog/items/${itemSysId}/order_now`,
      payload
    );

    return response.data.result;
  }
}
