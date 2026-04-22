import { AsyncLocalStorage } from "node:async_hooks";

export interface RequestContext {
  serviceNowAccessToken?: string;
  callerEntraObjectId?: string;
  callerUpn?: string;
}

const requestContextStorage = new AsyncLocalStorage<RequestContext>();

/**
 * Runs a callback within a request-scoped async context.
 * Use this to propagate caller identity and optional ServiceNow bearer token
 * to deep service layers without passing parameters through every function.
 */
export function runWithRequestContext<T>(context: RequestContext, callback: () => Promise<T>): Promise<T> {
  return requestContextStorage.run(context, callback);
}

/**
 * Returns the current request context for the active async execution path.
 */
export function getRequestContext(): RequestContext | undefined {
  return requestContextStorage.getStore();
}
