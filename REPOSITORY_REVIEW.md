# ServiceNow MCP Server — Repository Review

**Review Date**: March 25, 2026  
**Status**: ✅ **PRODUCTION-READY**

---

## Executive Summary

**Stateless MCP server** for ServiceNow hosted on Azure Functions with multi-tenant OAuth 2.0 (Entra ID). All four MCP tools are complete, security controls are in place, infrastructure is defined as code, and deployment runbooks are included.

---

## Architecture

| Layer | Technology |
|-------|-----------|
| Runtime | Azure Functions v4 (Node.js 20, Flex Consumption FC1) |
| Language | TypeScript (strict mode) |
| MCP Transport | Streamable HTTP (stateless) |
| Framework | Express.js |
| Auth (inbound) | OAuth 2.0 — Microsoft Entra ID, RS256 JWT |
| Auth (ServiceNow) | OAuth 2.0 — password or client_credentials grant |
| Validation | Zod, node:crypto JWKS verification |

### Exposed Endpoints

| Path | Purpose |
|------|---------|
| `/mcp` | MCP endpoint (Bearer-token protected) |
| `/health` | Readiness probe |
| `/.well-known/openid-configuration` | OIDC discovery |
| `/.well-known/oauth-authorization-server` | RFC 8414 alias |
| `/.well-known/oauth-protected-resource` | RFC 9728 metadata |
| `/oauth/register` | RFC 7591 Dynamic Client Registration |

---

## Source Layout

```
src/
├── app.ts                        # Express app + Entra middleware
├── config.ts                     # Environment variable config
├── requestContext.ts             # AsyncLocalStorage request context
├── functions/
│   ├── mcp.ts                    # Azure Functions HTTP trigger
│   └── oidc.ts                   # OIDC discovery + DCR endpoints
├── services/
│   ├── entraTokenValidator.ts    # Multi-tenant JWT validation
│   ├── servicenowClient.ts       # ServiceNow REST client + shared singleton
│   └── tokenManager.ts          # ServiceNow OAuth token caching
├── tools/
│   ├── index.ts                  # Tool registration + minimal manifests
│   ├── searchCatalogItems.ts
│   ├── getCatalogItemForm.ts
│   ├── placeOrder.ts
│   └── validateServiceNowConfiguration.ts
├── types/servicenow.ts
└── utils/adaptiveCards.ts
```

---

## MCP Tools

| Tool | Status | Purpose |
|------|--------|---------|
| `search_catalog_items` | ✅ Complete | Free-text catalog search; returns items + Adaptive Card |
| `get_catalog_item_form` | ✅ Complete | Retrieves order form as Adaptive Card |
| `place_order` | ✅ Complete | Submits catalog order; returns confirmation card |
| `validate_servicenow_configuration` | ✅ Complete | OAuth + API access diagnostic |

---

## Configuration

| Variable | Required | Notes |
|----------|----------|-------|
| `SERVICENOW_INSTANCE_URL` | Yes | `https://instance.service-now.com` |
| `SERVICENOW_CLIENT_ID` | Yes | App Registry client ID |
| `SERVICENOW_CLIENT_SECRET` | Yes | App Registry secret |
| `SERVICENOW_USERNAME` | Conditional | Required for password grant |
| `SERVICENOW_PASSWORD` | Conditional | Required for password grant |
| `SERVICENOW_OAUTH_GRANT_TYPE` | No | `auto` \| `password` \| `client_credentials` |
| `SERVICENOW_OAUTH_CLIENT_AUTH_STYLE` | No | `auto` \| `request_body` \| `basic` |
| `ENTRA_TENANT_ID` | Conditional | Required if OAuth enabled |
| `ENTRA_CLIENT_ID` | Conditional | Required if OAuth enabled |
| `ENTRA_CLIENT_SECRET` | No | Required for DCR support |
| `ENTRA_TRUSTED_TENANT_IDS` | No | Comma-separated remote tenant GUIDs |
| `ENTRA_ALLOW_ANY_TENANT` | No | `true` accepts any Microsoft tenant (dev only) |
| `ENTRA_AUTH_DISABLED` | No | `true` skips token validation (local dev only) |

---

## Security Controls

- **JWT validation**: RS256 signature via per-tenant JWKS (cached 1 h, auto-rotated on key rotation)
- **Tenant validation**: Primary, trusted-list, or any-tenant modes
- **Clock skew**: 5-minute allowance on `exp`/`nbf`
- **Audience validation**: Accepts GUID and `api://` URI forms
- **DCR token**: Optional timing-safe bearer check on `/oauth/register`
- **Secrets**: All secrets in Azure Key Vault; none in code or logs
- **Transport**: HTTPS enforced by Azure Functions

---

## Code Quality

- **Build**: ✅ Zero TypeScript errors (strict mode)
- **Dependencies**: Minimal — axios, express, zod, @azure/functions, @modelcontextprotocol/sdk, serverless-http
- **Token caching**: ServiceNow tokens use a single shared `ServiceNowClient` instance; JWKS cached per-tenant; OIDC metadata cached 1 h
- **Error handling**: HTTP status codes propagated; detailed messages in responses and Application Insights

---

## Infrastructure (Bicep)

`infra/main.bicep` provisions:
- Azure Function App (Flex Consumption)
- Application Insights + Log Analytics
- Key Vault (secrets via RBAC)
- Storage Account + Managed Identity

---

## Deployment

```bash
# Initialize environment
azd init
azd env set SERVICENOW_INSTANCE_URL "https://instance.service-now.com"
# ... set remaining variables

# Deploy
azd up
# or
pwsh scripts/deploy-azure.ps1

# Smoke test
npm run smoke:test
```

---

## Production Deployment Checklist

- [ ] Entra ID app registration created (multi-tenant, `access_as_user` scope)
- [ ] ServiceNow OAuth application registered with integration user
- [ ] Azure subscription access granted; `azd env` configured
- [ ] Deploy executed; smoke tests passing
- [ ] OIDC discovery endpoints verified
- [ ] MCP endpoint accepts Bearer token
- [ ] Copilot Studio connector created and tested end-to-end

---

**Conclusion**: The codebase is production-ready — complete feature set, proper security controls, Infrastructure as Code, and comprehensive documentation.  
**Next action**: Execute deployment when credentials are ready.
