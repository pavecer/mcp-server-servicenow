import { AsyncLocalStorage } from "node:async_hooks";

export interface RequestContext {
  serviceNowAccessToken?: string;
}

const requestContextStorage = new AsyncLocalStorage<RequestContext>();

export function runWithRequestContext<T>(context: RequestContext, callback: () => Promise<T>): Promise<T> {
  return requestContextStorage.run(context, callback);
}

export function getRequestContext(): RequestContext | undefined {
  return requestContextStorage.getStore();
}
