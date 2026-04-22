import { Request, Response, NextFunction } from "express";
import { config } from "../config";
import { validateEntraToken, buildAcceptedAudiences } from "../services/entraTokenValidator";
import Logger from "./logger";

/**
 * Shared Entra ID Bearer token validation middleware.
 * Used by both the MCP endpoint (app.ts) and the Catalog REST API (catalogApi.ts).
 *
 * Returns 401 with RFC 6750-compliant WWW-Authenticate headers on all failures:
 * - Missing token        → standard Bearer challenge with resource_metadata
 * - Expired/invalid token → error="invalid_token" so Power Platform triggers refresh
 *
 * Writes validated caller identity to res.locals:
 *   res.locals.callerEntraObjectId  (oid claim)
 *   res.locals.callerUpn            (preferred_username or upn)
 */
export function entraAuthMiddleware(req: Request, res: Response, next: NextFunction): void {
  const entra = config.entraAuth;

  if (entra.disabled || !entra.tenantId || !entra.clientId) {
    next();
    return;
  }

  const resourceMetadataUrl = `${req.protocol}://${req.get("host")}/.well-known/oauth-protected-resource`;
  const authHeader = req.header("Authorization") || req.header("authorization") || "";

  if (!authHeader.startsWith("Bearer ")) {
    Logger.warn("Entra auth: missing or invalid Bearer token", {
      operation: "entra_auth_missing",
      hasAuthHeader: !!authHeader
    });
    res
      .status(401)
      .set("WWW-Authenticate", `Bearer realm="${req.protocol}://${req.get("host")}", resource_metadata="${resourceMetadataUrl}"`)
      .json({
        error: "unauthorized",
        error_description: "A valid Entra ID Bearer token is required."
      });
    return;
  }

  const token = authHeader.slice(7);
  const acceptedAudiences = buildAcceptedAudiences(
    entra.clientId,
    entra.audience ?? undefined,
    entra.allowedAudiences
  );

  validateEntraToken(token, entra.tenantId, acceptedAudiences, entra.trustedTenantIds, entra.allowAnyTenant)
    .then(payload => {
      Logger.debug("Entra auth: token validated", {
        operation: "entra_auth_success"
      });
      res.locals.callerEntraObjectId = payload.oid;
      res.locals.callerUpn = payload.preferred_username || payload.upn;
      next();
    })
    .catch(err => {
      const errMsg = err instanceof Error ? err.message : "unknown error";
      const isExpired = errMsg.toLowerCase().includes("expired") || errMsg.toLowerCase().includes("exp");
      Logger.warn("Entra auth: token validation failed", {
        operation: "entra_auth_failed",
        reason: isExpired ? "token_expired" : "invalid_token"
      }, err);
      const wwwAuthenticate = [
        `Bearer realm="${req.protocol}://${req.get("host")}"`,
        `resource_metadata="${resourceMetadataUrl}"`,
        `error="invalid_token"`,
        `error_description="${isExpired ? "The access token has expired" : "The access token is invalid"}"`
      ].join(", ");

      res.status(401).set("WWW-Authenticate", wwwAuthenticate).json({
        error: "unauthorized",
        error_description: `Bearer token validation failed: ${errMsg}`
      });
    });
}
