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
    if (config.serviceNow.requireCallerAccessToken && !callerToken) {
      throw new Error(
        "ServiceNow caller access token is required. Provide x-servicenow-access-token so ServiceNow ACLs are enforced per user."
      );
    }

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

  private async updateRequestItemsRequestedFor(
    client: AxiosInstance,
    requestSysId: string,
    requestedForSysId: string
  ): Promise<void> {
    // Fetch all sc_req_item records that belong to this sc_request
    const itemsResponse = await client.get<{ result: Array<{ sys_id: string }> }>(
      "/api/now/table/sc_req_item",
      {
        params: {
          sysparm_query: `request=${requestSysId}`,
          sysparm_fields: "sys_id",
          sysparm_limit: 100
        }
      }
    );

    const items = itemsResponse.data.result || [];
    await Promise.all(
      items.map((item) =>
        client.patch(`/api/now/table/sc_req_item/${item.sys_id}`, {
          requested_for: requestedForSysId
        })
      )
    );
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

    // Always use sys_id for the request identifier - it's the reliable primary key
    const requestSysId = response.data.result.sys_id;
    if (
      typeof requestSysId === "string" &&
      typeof resolvedRequestedFor === "string" &&
      this.isLikelyServiceNowSysId(requestSysId) &&
      this.isLikelyServiceNowSysId(resolvedRequestedFor)
    ) {
      try {
        await this.updateRequestRequestedFor(client, requestSysId, resolvedRequestedFor);
        await this.updateRequestItemsRequestedFor(client, requestSysId, resolvedRequestedFor);
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

  async listUserOrders(
    limit?: number,
    fields?: string[]
  ): Promise<Array<Record<string, unknown>>> {
    const client = await this.getClient();
    const requestContext = getRequestContext();

    /**
     * Get the current user by looking up based on the requestor's credentials.
     * This will fetch the current user's sys_id to find orders they requested.
     */
    const callerValues = this.getCallerValues();
    let currentUserSysId: string | undefined;

    if (callerValues.length > 0) {
      const lookupFields = this.getRequestedForLookupFields();
      if (lookupFields.length > 0) {
        try {
          const userLookup = await this.lookupServiceNowUser(client, callerValues, lookupFields);
          currentUserSysId = userLookup.sysId;
        } catch {
          // Fall back to using the first caller value if lookup fails
        }
      }
    }

    // If we can't determine the user sys_id, we can't list their orders
    if (!currentUserSysId) {
      console.warn("[ServiceNowClient.listUserOrders] Unable to determine current user sys_id");
      return [];
    }

    // Build query for non-closed orders where the requesting user is the requester
    const sysparmQuery = `requested_for=${currentUserSysId}^state!=7^state!=6^state!=9`;

    const params: Record<string, string | number> = {
      sysparm_query: sysparmQuery,
      sysparm_limit: limit ?? 50
    };

    // Include specific fields if provided, otherwise return common fields
    const defaultFields = [
      "sys_id",
      "number",
      "short_description",
      "description",
      "state",
      "assignment_group",
      "assigned_to",
      "created_on",
      "updated_on",
      "request_status",
      "requested_for"
    ];

    params.sysparm_fields = (fields || defaultFields).join(",");

    try {
      const response = await client.get<{ result: Array<Record<string, unknown>> }>(
        "/api/now/table/sc_request",
        { params }
      );

      const requests = response.data.result || [];

      // Enrich each request with its related catalog items
      const enrichedRequests = await Promise.all(
        requests.map(async (request) => {
          const requestSysId = request.sys_id as string;
          try {
            // Fetch related items for this request from sc_req_item table
            const itemsResponse = await client.get<{ result: Array<Record<string, unknown>> }>(
              "/api/now/table/sc_req_item",
              {
                params: {
                  sysparm_query: `request=${requestSysId}`,
                  sysparm_limit: 100,
                  sysparm_fields: [
                    "sys_id",
                    "number",
                    "cat_item_id",
                    "quantity",
                    "state",
                    "short_description",
                    "description"
                  ].join(",")
                }
              }
            );

            const requestItems = itemsResponse.data.result || [];

            // Enrich each item with catalog item details
            const enrichedItems = await Promise.all(
              requestItems.map(async (item) => {
                const catItemId = item.cat_item_id as Record<string, unknown> | string | undefined;
                const catItemSysId = typeof catItemId === "object" ? catItemId.value : catItemId;

                if (!catItemSysId) {
                  return item;
                }

                try {
                  const catalogResponse = await client.get<{ result: ServiceNowCatalogItemDetail }>(
                    `/api/sn_sc/servicecatalog/items/${catItemSysId}`,
                    { params: { sysparm_expand_variables: "false" } }
                  );
                  return {
                    ...item,
                    catalogItem: catalogResponse.data.result
                  };
                } catch {
                  // If we can't fetch catalog details, return item as-is
                  return item;
                }
              })
            );

            return {
              ...request,
              requestItems: enrichedItems
            };
          } catch (error) {
            const errorMessage = error instanceof Error ? error.message : String(error);
            console.warn(
              "[ServiceNowClient.listUserOrders.enrichment] Error fetching items for request:",
              requestSysId,
              errorMessage
            );
            // Return request without items if enrichment fails
            return {
              ...request,
              requestItems: []
            };
          }
        })
      );

      return enrichedRequests;
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      console.error("[ServiceNowClient.listUserOrders] Error listing orders:", errorMessage);
      throw error;
    }
  }

  async updateOrder(
    requestSysId: string,
    updates: Record<string, unknown>
  ): Promise<Record<string, unknown>> {
    const client = await this.getClient();

    try {
      const response = await client.patch<{ result: Record<string, unknown> }>(
        `/api/now/table/sc_request/${requestSysId}`,
        updates
      );

      return response.data.result;
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      console.error("[ServiceNowClient.updateOrder] Error updating order:", errorMessage);
      throw error;
    }
  }
}
