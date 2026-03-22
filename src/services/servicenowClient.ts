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

export interface PlaceOrderInput {
  quantity?: number;
  requestedFor?: string;
  variables: Record<string, string | number | boolean>;
}

export class ServiceNowClient {
  private readonly tokenManager = new TokenManager();

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

    const payload: Record<string, unknown> = {
      sysparm_quantity: input.quantity ?? 1,
      variables: input.variables
    };

    if (input.requestedFor) {
      payload.sysparm_requested_for = input.requestedFor;
    }

    const response = await client.post<{ result: ServiceNowOrderResult }>(
      `/api/sn_sc/servicecatalog/items/${itemSysId}/order_now`,
      payload
    );

    return response.data.result;
  }
}
