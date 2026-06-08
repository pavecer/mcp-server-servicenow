# Custom MCP Connector with OBO / Silent SSO

This document is the validated, end-to-end recipe for getting **silent SSO with on-behalf-of (OBO)** working between Copilot Studio and this ServiceNow MCP server.

> **TL;DR**: the Copilot Studio MCP wizard provisions a connector with the `oauth2pkcewithprm` identity provider, which forces a per-user "Open connection manager" prompt on every host channel. To get true SSO/OBO you have to hand-author a custom MCP connector with `identityProvider: aad` and configure a **separate** Entra "client" app distinct from the API resource app. This is needed to avoid the `AADSTS90009: Application is requesting a token for itself` failure that occurs when the client and resource are the same Entra app.

**Status**: validated end-to-end on `func-xflvdzmohd3e2.azurewebsites.net` in tenant `1938ee32-a258-454c-b8db-3a928341bd69` (D365DemoTSCE54115347) on 2026-06-08. The Copilot Studio test pane now shows a single "Allow" approval card on the first tool call, with no separate Entra sign-in popup or "Open connection manager" prompt.

---

## Architecture

```
┌─────────────────────┐                  ┌────────────────────────┐
│ Copilot Studio Test │                  │  Function App          │
│ Pane / Teams / M365 │                  │  func-xflvdzmohd3e2    │
│                     │                  │                        │
│  Custom MCP         │   1. POST /mcp   │  POST /api/mcp         │
│  Connector          │   + Bearer JWT   │  validates JWT         │
│  (identityProvider: │ ───────────────► │  audience = API app    │
│    aad, OBO=true)   │                  │                        │
└──────────┬──────────┘                  │  ENTRA_OBO_ENABLED=true│
           │                             │  exchanges user token  │
           │ uses                        │  for ServiceNow token  │
           ▼                             └────────┬───────────────┘
┌─────────────────────┐                           │
│  Client Entra App   │                           │ 2. ServiceNow REST
│  ext_SnowCat-       │                           ▼   (as the user)
│  RemoteProxy        │
│  appId 6eb9f80d-... │ ── has delegated ────► API Entra App
│  + client secret    │    permission           "MCS MCP Snow"
│                     │    access_as_user       appId 8d73a1f1-...
│  + redirectUri      │                         + exposed scope
│    matches PP       │                           access_as_user
│    connector URL    │                         + pre-authorizes
└─────────────────────┘                           the client app
```

Two Entra apps are required because Entra ID rejects an OAuth code flow where the **client** and the **resource (audience)** are the same app. That rejection surfaces as:

```
AADSTS90009: Application '8d73a1f1-...' is requesting a token for itself.
This scenario is supported only if resource is specified using the GUID
based App Identifier.
```

The fix is structural: keep the API resource app as is, add a separate client app, and point the custom connector at the client app.

---

## Prerequisites

- An existing MCP server deployment with `ENTRA_OBO_ENABLED=true` and `ENTRA_OBO_DOWNSTREAM_SCOPE` set (this repo defaults to `api://<API_APP_ID>/ServiceNow.Use`).
- The API Entra app (this repo: `MCS MCP Snow`, appId `8d73a1f1-5a04-42dd-bbdc-5da72feb6fc5`) with the `access_as_user` delegated scope exposed.
- Owner/admin access to the target Power Platform environment.
- Owner/admin access to the target Entra tenant for App Registration changes.
- Owner access to the Function App's Key Vault so the new client secret can be stored alongside `entra-client-secret`.

---

## Step 1 — Identify or create the client Entra app

You need an Entra app registration that is **distinct** from the API resource app and will hold the connector's OAuth client credentials.

### If you already have a candidate app

Look for an app whose `requiredResourceAccess` already targets the API app (`8d73a1f1-...`) with the `access_as_user` scope (id `16ad9a5e-fd63-45c1-b731-f23ba6adb4b9` in this tenant). In the validated deployment we reused `ext_SnowCat-RemoteProxy` (appId `6eb9f80d-697f-4937-93c8-751de310a3c2`) which was already configured with exactly that permission.

Quick check via Graph:

```bash
TOKEN=$(az account get-access-token --resource https://graph.microsoft.com --query accessToken -o tsv)
curl -s -H "Authorization: Bearer $TOKEN" \
  "https://graph.microsoft.com/v1.0/applications?\$filter=appId eq '<CANDIDATE_APP_ID>'&\$select=displayName,requiredResourceAccess,web,passwordCredentials" \
  | jq .
```

Required for the candidate app:
- At least one entry in `requiredResourceAccess` where `resourceAppId == <API_APP_ID>` and `resourceAccess` includes the `access_as_user` scope as a Scope (delegated).
- A non-expired `passwordCredentials` entry (or be ready to add one — see Step 2).

### If you need a new app

Create with the Azure CLI:

```bash
az ad app create --display-name "<your-name> MCP Connector Client" \
  --sign-in-audience AzureADMyOrg
```

Then add the required permission:

```bash
CLIENT_APP_ID=<new appId>
API_APP_ID=8d73a1f1-5a04-42dd-bbdc-5da72feb6fc5
SCOPE_ID=16ad9a5e-fd63-45c1-b731-f23ba6adb4b9  # access_as_user
az ad app permission add --id $CLIENT_APP_ID \
  --api $API_APP_ID --api-permissions "$SCOPE_ID=Scope"
az ad app permission grant --id $CLIENT_APP_ID --api $API_APP_ID --scope access_as_user
```

---

## Step 2 — Mint a client secret and store it in Key Vault

The Power Platform custom connector wants a real client secret (no PKCE / public client for this flow). Mint a fresh 2-year secret and persist it in Key Vault so it can be rotated alongside `entra-client-secret`.

> **Important**: Entra returns the secret value exactly once. You MUST write it to Key Vault in the same command that creates it. If you lose the value, remove the password and start over — there is no recovery.

```bash
TOKEN=$(az account get-access-token --resource https://graph.microsoft.com --query accessToken -o tsv)
CLIENT_OBJ_ID=$(az ad app show --id <CLIENT_APP_ID> --query id -o tsv)
END=$(python3 -c "import datetime; print((datetime.datetime.utcnow()+datetime.timedelta(days=730)).isoformat()+'Z')")

RESP=$(curl -s -X POST -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
  "https://graph.microsoft.com/v1.0/applications/$CLIENT_OBJ_ID/addPassword" \
  -d "{\"passwordCredential\":{\"displayName\":\"mcp-connector-$(date +%Y-%m)\",\"endDateTime\":\"$END\"}}")
KEY_ID=$(echo "$RESP" | jq -r .keyId)
SECRET=$(echo "$RESP" | jq -r .secretText)

az keyvault secret set --vault-name <YOUR_KV_NAME> \
  --name snowcat-remoteproxy-client-secret \
  --value "$SECRET" \
  --tags appId="<CLIENT_APP_ID>" keyId="$KEY_ID" purpose="MCP custom connector OBO client"
```

The validated deployment stores the secret as `snowcat-remoteproxy-client-secret` in vault `kv-xflvdzmohd3e2`.

---

## Step 3 — Add the connector's redirect URI to the client app

Power Platform mints a deterministic redirect URI per custom connector, of the form:

```
https://global.consent.azure-apim.net/redirect/<connector-internal-name>
```

The connector internal name is derived from your connector display name and a stable hash. You can read it from the connector's `runtimeUrls` after creation:

```bash
TOKEN=$(az account get-access-token --resource https://service.powerapps.com/ --query accessToken -o tsv)
ENV=<your-env-guid>
CONN=shared_<connector-internal-name>
curl -s -H "Authorization: Bearer $TOKEN" \
  "https://api.powerapps.com/providers/Microsoft.PowerApps/apis/$CONN?api-version=2017-06-01&\$filter=environment eq '$ENV'" \
  | jq -r '.properties.connectionParameters.token.oAuthSettings.redirectUrl'
```

Add that exact URL to the client Entra app's `web.redirectUris` (additive — keep any existing ones):

```bash
TOKEN=$(az account get-access-token --resource https://graph.microsoft.com --query accessToken -o tsv)
CLIENT_OBJ_ID=<client app object id>
NEW_URI=https://global.consent.azure-apim.net/redirect/<connector-internal-name>
# Pull existing list first, then PATCH the union
curl -s -H "Authorization: Bearer $TOKEN" \
  "https://graph.microsoft.com/v1.0/applications/$CLIENT_OBJ_ID?\$select=web" \
  | jq --arg new "$NEW_URI" '.web.redirectUris += [$new] | .web.redirectUris |= unique | {web:{redirectUris:.web.redirectUris}}' \
  > /tmp/patch.json
curl -s -X PATCH -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
  "https://graph.microsoft.com/v1.0/applications/$CLIENT_OBJ_ID" \
  -d @/tmp/patch.json
```

---

## Step 4 — Pre-authorize the client on the API app (skip user consent)

Without this step, the very first user to sign in through the connector sees an Entra consent screen ("This app would like to access ServiceNow MCP on your behalf"). Pre-authorizing the client app skips that prompt for every user.

```bash
TOKEN=$(az account get-access-token --resource https://graph.microsoft.com --query accessToken -o tsv)
API_OBJ_ID=<MCS MCP Snow object id>
CLIENT_APP_ID=<client appId>
SCOPE_ID=16ad9a5e-fd63-45c1-b731-f23ba6adb4b9  # access_as_user
# Also include ServiceNow.Use (fac192ba-...) if you use the OBO downstream scope

curl -s -H "Authorization: Bearer $TOKEN" \
  "https://graph.microsoft.com/v1.0/applications/$API_OBJ_ID?\$select=api" \
  > /tmp/api.json

python3 <<PY > /tmp/patch.json
import json
d = json.load(open('/tmp/api.json'))
api = d['api']
pa = api.get('preAuthorizedApplications', [])
client = "$CLIENT_APP_ID"
scopes = ["$SCOPE_ID", "fac192ba-1f29-4b07-a13a-32216ed03e22"]  # add/remove as needed
existing = next((p for p in pa if p['appId']==client), None)
if existing:
    existing['delegatedPermissionIds'] = list({*existing.get('delegatedPermissionIds',[]), *scopes})
else:
    pa.append({"appId": client, "delegatedPermissionIds": scopes})
api['preAuthorizedApplications'] = pa
print(json.dumps({"api": api}))
PY

curl -s -X PATCH -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
  "https://graph.microsoft.com/v1.0/applications/$API_OBJ_ID" \
  -d @/tmp/patch.json
```

---

## Step 5 — Provision the custom MCP connector

You can do this from the Power Platform maker portal UI **or** via the REST API. The validated path is REST API because the maker UI does not expose every field reliably for MCP-typed connectors.

### Minimum OpenAPI swagger payload

The connector must declare a single `POST /mcp` operation with the `x-ms-agentic-protocol: mcp-streamable-1.0` annotation. This is what tells Copilot Studio to treat the connector as an MCP transport rather than a REST API.

```jsonc
{
  "swagger": "2.0",
  "info": { "title": "SNOW Test", "description": "...", "version": "1.0" },
  "host": "func-xflvdzmohd3e2.azurewebsites.net",
  "basePath": "/",
  "schemes": ["https"],
  "consumes": ["application/json"],
  "produces": ["application/json"],
  "paths": {
    "/mcp": {
      "post": {
        "operationId": "InvokeServer",
        "summary": "SNOW Test",
        "description": "ServiceNow MCP server for catalog search and ordering",
        "x-ms-agentic-protocol": "mcp-streamable-1.0",
        "parameters": [
          { "in": "header", "name": "Mcp-Session-Id", "required": false, "type": "string",
            "description": "MCP session id", "x-ms-summary": "Session Id" },
          { "in": "body", "name": "queryRequest", "required": false,
            "schema": { "$ref": "#/definitions/QueryRequest" } }
        ],
        "responses": { "200": { "description": "Immediate Response" } }
      }
    }
  },
  "definitions": {
    "QueryRequest": { "type": "object", "additionalProperties": true }
  }
}
```

Validator quirks worth knowing about (all hit during the validated rollout):

| Symptom | Fix |
|---|---|
| `Swagger contains base path:/apim/... but backend Url doesn't end on same path:/` | Set `host` to the Function App hostname and `basePath` to `/`. Do not echo back the proxied APIM host. |
| `Paths with x-ms-agentic-protocol should only have a POST operation.` | Drop any `GET` (or other non-POST) sibling on the same path. |
| `Non-unique array item at index N. Path '...post.tags[2]'` | Strip `tags` from operations entirely. Power Platform appends its own tags and the duplicate trips a strict validator on PATCH. |
| `CannotUpdateApiDisplayName` | Do not send `displayName` in the PATCH body. |

### OAuth/connection parameters block

```jsonc
{
  "connectionParameters": {
    "token": {
      "type": "oauthSetting",
      "oAuthSettings": {
        "identityProvider": "aad",
        "clientId": "<CLIENT_APP_ID>",                              // SEPARATE from API app id
        "clientSecret": "<value from KV>",
        "scopes": ["api://<API_APP_ID>/access_as_user"],            // single delegated scope
        "redirectMode": "GlobalPerConnector",
        "redirectUrl": "https://global.consent.azure-apim.net/redirect/<connector-internal-name>",
        "properties": {
          "IsFirstParty": "True",
          "AzureActiveDirectoryResourceId": "api://<API_APP_ID>",   // resource = API app
          "IsOnbehalfofLoginSupported": true
        },
        "customParameters": {
          "loginUri":              { "value": "https://login.windows.net" },
          "resourceUri":           { "value": "api://<API_APP_ID>" },
          "tenantId":              { "value": "<TENANT_ID>" },
          "enableOnbehalfOfLogin": { "value": "true" }
        }
      }
    }
  }
}
```

The full PATCH body is `properties.{connectionParameters, openApiDefinition, iconBrandColor, capabilities, description, policyTemplateInstances, environment, backendService}`. Send `backendService.serviceUrl = https://<your-function-app>.azurewebsites.net/` (with trailing slash).

### Sanity-check after PATCH

```bash
curl -s -H "Authorization: Bearer $TOKEN" \
  "https://api.powerapps.com/providers/Microsoft.PowerApps/apis/$CONN?api-version=2017-06-01&\$filter=environment eq '$ENV'" \
  | jq '.properties.connectionParameters.token.oAuthSettings | {clientId, scopes, redirectUrl, properties, customParameters}'
```

Expected:
- `clientId` ≠ the GUID embedded in `scopes`/`resourceUri`.
- `properties.IsOnbehalfofLoginSupported = true`.
- `customParameters.enableOnbehalfOfLogin = "true"`.

---

## Step 6 — Delete and recreate any existing connection

Power Platform caches the connection's identity-provider config at connection-create time. Any pre-existing connection of this connector that was created while it was misconfigured (e.g., same-app AADSTS90009) is permanently broken and must be replaced.

1. Go to https://make.powerautomate.com → **Connections**.
2. Find the connection for this connector. Delete it.
3. From the agent (or any flow) trigger the connector — Power Platform will redirect to sign in and create a fresh connection.
4. Expected experience: a single small "Allow" approval card on the first tool invocation, **no** Entra sign-in popup (thanks to the pre-authorization in Step 4), **no** "Open connection manager" prompt.

---

## Step 7 — Verify in Copilot Studio

In the agent's test pane:

1. First tool invocation → "Allow" approval card → click Allow.
2. The MCP tool runs immediately as the signed-in user.
3. The downstream ServiceNow call uses `requested_for = <the signed-in user>` (verify in the ServiceNow request audit log).

Subsequent invocations in the same session, and across new sessions for the same user, are silent until the refresh token expires (~90 days idle, sliding window if used).

---

## Troubleshooting

### AADSTS90009: Application is requesting a token for itself

Cause: the connector's `clientId` and `resourceUri` reference the same Entra app. Fix per Steps 1-5: introduce or reuse a separate client app and PATCH the connector to point `clientId` at it (while keeping `resourceUri` and the scope on the API app).

### Connection pops up an Entra consent screen

Cause: client app is not pre-authorized on the API app for the requested scope. Repeat Step 4.

### Refresh token revoked after Entra app secret rotation

Cause: rotating the client secret on the client Entra app without also pushing the new value into the custom connector invalidates every user's stored refresh token. Sequence:

1. Mint the new secret (Step 2).
2. Store in Key Vault (Step 2).
3. PATCH the connector with the new `clientSecret` value (Step 5, OAuth block only).
4. Remove the old secret from the client Entra app **last**, after verifying a fresh sign-in works.

### "Tools not visible" after connector creation

Cause: the swagger validation may have rejected the PATCH silently. Re-fetch the connector and inspect `properties.swagger.paths` — if the body is empty or missing `/mcp`, your PATCH did not stick. See the "Validator quirks" table above.

---

## Reference: validated deployment values

| Field | Value |
|---|---|
| Tenant | `1938ee32-a258-454c-b8db-3a928341bd69` (D365DemoTSCE54115347) |
| Env | `67203dc9-8a11-e6ef-9970-81e05021161c` (PVE Preview Sand US) |
| Function App | `func-xflvdzmohd3e2.azurewebsites.net` |
| API Entra app | `MCS MCP Snow` / `8d73a1f1-5a04-42dd-bbdc-5da72feb6fc5` |
| Client Entra app | `ext_SnowCat-RemoteProxy` / `6eb9f80d-697f-4937-93c8-751de310a3c2` |
| KV secret name | `snowcat-remoteproxy-client-secret` (vault `kv-xflvdzmohd3e2`) |
| Custom connector | `SNOW Test` / `shared_cr7a3-5fsnow-20test-5f635855ea92fead22` |
| Connector redirect URI | `https://global.consent.azure-apim.net/redirect/cr7a3-5fsnow-20test-5f635855ea92fead22` |
| Scope | `api://8d73a1f1-5a04-42dd-bbdc-5da72feb6fc5/access_as_user` |
