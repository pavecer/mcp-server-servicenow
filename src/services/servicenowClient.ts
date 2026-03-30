import axios, { AxiosInstance } from "axios";
import { config } from "../config";
import {
  RequestedForDiagnostics,
  ServiceNowCatalogItem,
  ServiceNowCatalogItemDetail,
  ServiceNowOrderResult,
  ServiceNowPlaceOrderResponse
} from "../types/servicenow";
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
  [key: string]: unknown;
}

type CallerField = "callerUpn" | "callerEntraObjectId";

interface RequestedForResolution {
  value?: string;
  diagnostics: RequestedForDiagnostics;
}

export interface PlaceOrderInput {
  quantity?: number;
  requestedFor?: string;
  variables: Record<string, string | number | boolean>;
}

export class ServiceNowClient {
  private readonly tokenManager = new TokenManager();

  private isLikelyServiceNowSysId(value: string | undefined): boolean {
    return typeof value === "string" && /^[0-9a-f]{32}$/i.test(value);
  }

  private sanitizeSysparmQueryValue(value: string): string {
    // ServiceNow encoded queries use ^ as a delimiter, strip it from user-derived values.
    return value.replace(/\^/g, "").trim();
  }

  private sanitizeSysparmFieldName(value: string): string {
    const trimmed = value.trim();
    return /^[A-Za-z0-9_]+$/.test(trimmed) ? trimmed : "";
  }

  private getRequestedForLookupFields(): string[] {
    return config.serviceNow.requestedForLookupFields
      .map(field => this.sanitizeSysparmFieldName(field))
      .filter(Boolean);
  }

  private async lookupServiceNowUser(
    client: AxiosInstance,
    candidateValues: string[],
    lookupFields: string[]
  ): Promise<{ sysId?: string; matchedLookupField: string | null; matchedLookupValue: string | null }> {
    if (candidateValues.length === 0 || lookupFields.length === 0) {
      return {
        matchedLookupField: null,
        matchedLookupValue: null
      };
    }

    const lookupClauses: string[] = [];
    for (const candidateValue of candidateValues) {
      for (const field of lookupFields) {
        lookupClauses.push(`${field}=${candidateValue}`);
      }
    }

    if (lookupClauses.length === 0) {
      return {
        matchedLookupField: null,
        matchedLookupValue: null
      };
    }

    const sysparmQuery = `active=true^${lookupClauses.join("^OR")}`;
    const response = await client.get<{ result: ServiceNowUserLookupRecord[] }>("/api/now/table/sys_user", {
      params: {
        sysparm_query: sysparmQuery,
        sysparm_fields: ["sys_id", ...lookupFields].join(","),
        sysparm_limit: 1
      }
    });

    const matchedUser = response.data.result?.[0];
    const resolvedSysId = matchedUser?.sys_id;
    if (!resolvedSysId) {
      return {
        matchedLookupField: null,
        matchedLookupValue: null
      };
    }

    let matchedLookupField: string | null = null;
    let matchedLookupValue: string | null = null;

    for (const field of lookupFields) {
      const rawValue = matchedUser?.[field];
      if (typeof rawValue !== "string" || !rawValue.trim()) {
        continue;
      }

      const normalizedValue = this.sanitizeSysparmQueryValue(rawValue);
      if (candidateValues.includes(normalizedValue)) {
        matchedLookupField = field;
        matchedLookupValue = normalizedValue;
        break;
      }
    }

    return {
      sysId: resolvedSysId,
      matchedLookupField,
      matchedLookupValue
    };
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

  private async resolveRequestedFor(client: AxiosInstance, explicitRequestedFor?: string): Promise<RequestedForResolution> {
    const requestContext = getRequestContext();
    const requestedFor = explicitRequestedFor?.trim();
    const lookupFields = this.getRequestedForLookupFields();

    if (requestedFor) {
      const explicitValues = [this.sanitizeSysparmQueryValue(requestedFor)].filter(Boolean);

      if (lookupFields.length > 0 && explicitValues.length > 0) {
        try {
          const lookupResult = await this.lookupServiceNowUser(client, explicitValues, lookupFields);
          if (lookupResult.sysId) {
            return {
              value: lookupResult.sysId,
              diagnostics: {
                source: "explicit",
                explicitRequestedForProvided: true,
                resolvedRequestedFor: lookupResult.sysId,
                callerUpn: requestContext?.callerUpn ?? null,
                callerEntraObjectId: requestContext?.callerEntraObjectId ?? null,
                callerValues: explicitValues,
                lookupFields,
                matchedLookupField: lookupResult.matchedLookupField,
                matchedLookupValue: lookupResult.matchedLookupValue
              }
            };
          }
        } catch {
          // Fall back to passing the explicit value through unchanged.
        }
      }

      return {
        value: requestedFor,
        diagnostics: {
          source: "explicit",
          explicitRequestedForProvided: true,
          resolvedRequestedFor: requestedFor,
          callerUpn: requestContext?.callerUpn ?? null,
          callerEntraObjectId: requestContext?.callerEntraObjectId ?? null,
          callerValues: explicitValues,
          lookupFields,
          matchedLookupField: null,
          matchedLookupValue: null
        }
      };
    }

    const callerValues = this.getCallerValues();

    if (callerValues.length === 0) {
      return {
        diagnostics: {
          source: "none",
          explicitRequestedForProvided: false,
          resolvedRequestedFor: null,
          callerUpn: requestContext?.callerUpn ?? null,
          callerEntraObjectId: requestContext?.callerEntraObjectId ?? null,
          callerValues,
          lookupFields,
          matchedLookupField: null,
          matchedLookupValue: null
        }
      };
    }

    if (lookupFields.length > 0) {
      try {
        const lookupResult = await this.lookupServiceNowUser(client, callerValues, lookupFields);
        if (lookupResult.sysId) {
          return {
            value: lookupResult.sysId,
            diagnostics: {
              source: "caller_lookup",
              explicitRequestedForProvided: false,
              resolvedRequestedFor: lookupResult.sysId,
              callerUpn: requestContext?.callerUpn ?? null,
              callerEntraObjectId: requestContext?.callerEntraObjectId ?? null,
              callerValues,
              lookupFields,
              matchedLookupField: lookupResult.matchedLookupField,
              matchedLookupValue: lookupResult.matchedLookupValue
            }
          };
        }
      } catch {
        // Fall through to caller value fallback.
      }
    }

    if (!config.serviceNow.requestedForFallbackToCallerValue) {
      return {
        diagnostics: {
          source: "none",
          explicitRequestedForProvided: false,
          resolvedRequestedFor: null,
          callerUpn: requestContext?.callerUpn ?? null,
          callerEntraObjectId: requestContext?.callerEntraObjectId ?? null,
          callerValues,
          lookupFields,
          matchedLookupField: null,
          matchedLookupValue: null
        }
      };
    }

    // Use first configured caller value (for example callerUpn) when lookup does not resolve.
    return {
      value: callerValues[0],
      diagnostics: {
        source: "caller_fallback",
        explicitRequestedForProvided: false,
        resolvedRequestedFor: callerValues[0],
        callerUpn: requestContext?.callerUpn ?? null,
        callerEntraObjectId: requestContext?.callerEntraObjectId ?? null,
        callerValues,
        lookupFields,
        matchedLookupField: null,
        matchedLookupValue: null
      }
    };
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

  private async updateRequestRequestedFor(
    client: AxiosInstance,
    requestSysId: string,
    requestedForSysId: string
  ): Promise<void> {
    await client.patch(`/api/now/table/sc_request/${requestSysId}`, {
      requested_for: requestedForSysId
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

  async placeOrder(itemSysId: string, input: PlaceOrderInput): Promise<ServiceNowPlaceOrderResponse> {
    const client = await this.getClient();
    const requestedForResolution = await this.resolveRequestedFor(client, input.requestedFor);
    const resolvedRequestedFor = requestedForResolution.value;

    const payload: Record<string, unknown> = {
      sysparm_quantity: input.quantity ?? 1,
      variables: input.variables
    };

    if (resolvedRequestedFor) {
      payload.sysparm_requested_for = resolvedRequestedFor;
    }

    console.info("[ServiceNowClient.placeOrder.requestedFor]", JSON.stringify({
      itemSysId,
      source: requestedForResolution.diagnostics.source,
      explicitRequestedForProvided: requestedForResolution.diagnostics.explicitRequestedForProvided,
      resolvedRequestedFor: requestedForResolution.diagnostics.resolvedRequestedFor,
      callerUpn: requestedForResolution.diagnostics.callerUpn,
      callerEntraObjectId: requestedForResolution.diagnostics.callerEntraObjectId,
      callerValues: requestedForResolution.diagnostics.callerValues,
      lookupFields: requestedForResolution.diagnostics.lookupFields,
      matchedLookupField: requestedForResolution.diagnostics.matchedLookupField,
      matchedLookupValue: requestedForResolution.diagnostics.matchedLookupValue,
      usedCallerServiceNowToken: Boolean(getRequestContext()?.serviceNowAccessToken)
    }));

    const response = await client.post<{ result: ServiceNowOrderResult }>(
      `/api/sn_sc/servicecatalog/items/${itemSysId}/order_now`,
      payload
    );

    const requestSysId = response.data.result.request_id ?? response.data.result.sys_id;
    if (
      typeof requestSysId === "string" &&
      typeof resolvedRequestedFor === "string" &&
      this.isLikelyServiceNowSysId(requestSysId) &&
      this.isLikelyServiceNowSysId(resolvedRequestedFor)
    ) {
      try {
        await this.updateRequestRequestedFor(client, requestSysId, resolvedRequestedFor);
        console.info("[ServiceNowClient.placeOrder.requestedForPatched]", JSON.stringify({
          itemSysId,
          requestSysId,
          requestedForSysId: resolvedRequestedFor
        }));
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : String(error);
        console.warn("[ServiceNowClient.placeOrder.requestedForPatchFailed]", JSON.stringify({
          itemSysId,
          requestSysId,
          requestedForSysId: resolvedRequestedFor,
          error: errorMessage
        }));
      }
    }

    return {
      result: response.data.result,
      requestedForDiagnostics: requestedForResolution.diagnostics
    };
  }
}
