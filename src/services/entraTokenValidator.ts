import crypto from "node:crypto";
import axios from "axios";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface EntraJwk {
  kid?: string;
  kty: string;
  use?: string;
  n?: string;
  e?: string;
  alg?: string;
}

interface JwksCache {
  keys: Map<string, EntraJwk>;
  expiresAtMs: number;
}

export interface EntraTokenPayload {
  oid: string;
  tid: string;
  iss: string;
  aud: string | string[];
  exp: number;
  nbf: number;
  preferred_username?: string;
  upn?: string;
  name?: string;
}

// ---------------------------------------------------------------------------
// JWKS cache (module-level singleton; safe per Azure Functions instance)
// ---------------------------------------------------------------------------

const JWKS_CACHE_TTL_MS = 60 * 60 * 1_000; // 1 hour
const MAX_CLOCK_SKEW_SECONDS = 300; // 5 minutes

let jwksCache: JwksCache | undefined;

async function fetchJwks(jwksUri: string): Promise<Map<string, EntraJwk>> {
  const { data } = await axios.get<{ keys: EntraJwk[] }>(jwksUri, { timeout: 10_000 });
  return new Map(
    data.keys
      .filter(k => k.kid && k.kty === "RSA" && (!k.use || k.use === "sig"))
      .map(k => [k.kid!, k])
  );
}

async function getSigningKey(kid: string, jwksUri: string): Promise<crypto.KeyObject> {
  const now = Date.now();

  if (!jwksCache || now > jwksCache.expiresAtMs) {
    jwksCache = {
      keys: await fetchJwks(jwksUri),
      expiresAtMs: now + JWKS_CACHE_TTL_MS
    };
  }

  let jwk = jwksCache.keys.get(kid);
  if (!jwk) {
    // Signing key not found — the IdP may have rotated keys, refresh once.
    jwksCache = {
      keys: await fetchJwks(jwksUri),
      expiresAtMs: now + JWKS_CACHE_TTL_MS
    };
    jwk = jwksCache.keys.get(kid);
    if (!jwk) {
      throw new Error(`Unknown signing key kid=${kid}`);
    }
  }

  return crypto.createPublicKey(
    { key: jwk, format: "jwk" } as Parameters<typeof crypto.createPublicKey>[0]
  );
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function base64urlDecode(input: string): string {
  const base64 = input.replace(/-/g, "+").replace(/_/g, "/");
  const padded = base64 + "=".repeat((4 - (base64.length % 4)) % 4);
  return Buffer.from(padded, "base64").toString("utf8");
}

function base64urlToBuffer(input: string): Buffer {
  const base64 = input.replace(/-/g, "+").replace(/_/g, "/");
  const padded = base64 + "=".repeat((4 - (base64.length % 4)) % 4);
  return Buffer.from(padded, "base64");
}

// ---------------------------------------------------------------------------
// Token validation
// ---------------------------------------------------------------------------

/**
 * Validates a Microsoft Entra ID (Azure AD) v2.0 access token using the
 * tenant's public JWKS endpoint. Uses only Node.js 20 built-ins (node:crypto)
 * plus the project-local axios instance — no extra dependencies.
 *
 * @param bearerToken  Raw JWT value (without "Bearer " prefix).
 * @param tenantId     Entra tenant ID (GUID or domain).
 * @param acceptedAudiences  Set of allowed `aud` values (at least one must match).
 */
export async function validateEntraToken(
  bearerToken: string,
  tenantId: string,
  acceptedAudiences: Set<string>
): Promise<EntraTokenPayload> {
  const parts = bearerToken.split(".");
  if (parts.length !== 3) {
    throw new Error("Malformed JWT: expected three dot-separated segments");
  }

  const [headerB64, payloadB64, signatureB64] = parts;

  // Decode header and payload.
  const header: { kid?: string; alg?: string } = JSON.parse(base64urlDecode(headerB64));
  const payload: EntraTokenPayload = JSON.parse(base64urlDecode(payloadB64));

  if (header.alg && header.alg !== "RS256") {
    throw new Error(`Unsupported signing algorithm: ${header.alg}`);
  }

  if (!header.kid) {
    throw new Error("JWT header missing kid");
  }

  // Fetch public key and verify RS256 signature.
  const jwksUri = `https://login.microsoftonline.com/${tenantId}/discovery/v2.0/keys`;
  const publicKey = await getSigningKey(header.kid, jwksUri);

  const verifier = crypto.createVerify("RSA-SHA256");
  verifier.update(`${headerB64}.${payloadB64}`);
  const signatureBuffer = base64urlToBuffer(signatureB64);

  if (!verifier.verify(publicKey, signatureBuffer)) {
    throw new Error("Invalid JWT signature");
  }

  // Validate standard claims.
  const nowSec = Math.floor(Date.now() / 1_000);

  // Ensure exp is a finite number and present.
  if (typeof payload.exp !== "number" || !Number.isFinite(payload.exp)) {
    throw new Error("Invalid or missing exp claim");
  }

  if (payload.exp < nowSec) {
    throw new Error("Token has expired");
  }

  // Allow up to 5-minute clock skew.
  if (payload.nbf !== undefined) {
    if (typeof payload.nbf !== "number" || !Number.isFinite(payload.nbf)) {
      throw new Error("Invalid nbf claim");
    }
    if (payload.nbf > nowSec + MAX_CLOCK_SKEW_SECONDS) {
      throw new Error("Token not yet valid (nbf)");
    }
  }

  // Issuer must be a valid Entra v2 endpoint for the expected tenant.
  if (!payload.iss) {
    throw new Error("Missing issuer");
  }

  let issUrl: URL;
  try {
    issUrl = new URL(payload.iss);
  } catch {
    throw new Error("Invalid issuer");
  }

  const issuerHostValid =
    issUrl.hostname === "login.microsoftonline.com" ||
    issUrl.hostname === "sts.windows.net";

  // Normalize path and extract "{tenant}/v2.0".
  const pathSegments = issUrl.pathname.replace(/^\/+|\/+$/g, "").split("/");
  const [issuerTenant, issuerVersion] = pathSegments;

  const issuerVersionValid = issuerVersion === "v2.0";
  const issuerTenantMatchesConfig = issuerTenant === tenantId;
  const issuerTenantMatchesTid = typeof payload.tid === "string" && issuerTenant === payload.tid;

  if (
    !issuerHostValid ||
    !issuerVersionValid ||
    !(issuerTenantMatchesConfig || issuerTenantMatchesTid)
  ) {
    throw new Error("Invalid issuer");
  }
  // At least one aud value must be in the accepted set.
  const tokenAudiences = Array.isArray(payload.aud) ? payload.aud : [payload.aud];
  if (!tokenAudiences.some(a => acceptedAudiences.has(a))) {
    throw new Error("Invalid audience");
  }

  return payload;
}

/**
 * Builds the set of accepted audience values for a given Entra client ID.
 * Includes both the GUID and the conventional api:// App ID URI.
 */
export function buildAcceptedAudiences(clientId: string, audienceOverride?: string): Set<string> {
  const audiences = new Set<string>([clientId, `api://${clientId}`]);
  if (audienceOverride && audienceOverride !== clientId) {
    audiences.add(audienceOverride);
  }
  return audiences;
}
