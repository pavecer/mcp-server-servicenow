# Microsoft Copilot Studio Setup

This guide covers adding the ServiceNow MCP tool to a Copilot Studio agent and configuring the Adaptive Card ordering topic.

**Prerequisites**: MCP server deployed to Azure with Entra ID configured (see [README.md](README.md)).

---

## Step 1 - Add the MCP Tool

1. Open your agent in [Microsoft Copilot Studio](https://copilotstudio.microsoft.com).
2. Go to **Tools > Add a tool > Model Context Protocol**.
3. Fill in:

   | Field | Value |
   |-------|-------|
   | Server name | `ServiceNow MCP` |
   | Server description | `MCP server for ServiceNow catalog search, order form retrieval, and order placement` |
   | Server URL | `https://<your-function-app>.azurewebsites.net/mcp` |
   | Authentication | `OAuth 2.0` |
   | Type | `Dynamic discovery` |

4. Click **Create**.
5. Copilot Studio reads `/.well-known/openid-configuration` and registers an OAuth client automatically.
6. When prompted, sign in with any account in your Entra tenant.
7. Verify all 4 tools appear:
   - `search_catalog_items`
   - `get_catalog_item_form`
   - `place_order`
   - `validate_servicenow_configuration`

---

## Step 2 - Import the Ordering Topic

`copilot-studio/topics/[CTOP] - SnowMCP OrderCat.yaml` implements the full ServiceNow ordering flow with Adaptive Cards.

**Flow**: User states intent -> Search items (Adaptive Card picker) -> Select item -> Fill order form (Adaptive Card) -> Confirm -> Place order -> Show confirmation Adaptive Card.

### Import via UI (if your Copilot Studio environment supports YAML import)

1. Copilot Studio > **Topics > Add a topic > Import**
2. Upload the YAML file
3. Review the imported nodes, then **Publish** the agent

### Manual recreation

Use the YAML file as a blueprint. The topic has 6 action steps:

| Step | Type | What it does |
|------|------|--------------|
| 1 | Question | Ask the user what they want to order |
| 2 | Tool call | search_catalog_items - send selectionAdaptiveCard to user |
| 3 | Question | Capture the item sys_id from the card submit |
| 4 | Tool call | get_catalog_item_form - send formAdaptiveCard to user |
| 5 | Question | Capture the submitted form JSON string |
| 6 | Tool call | place_order with sys_id + form values - send confirmationAdaptiveCard |

See [docs/MCS_ACTION_CONTRACTS.md](docs/MCS_ACTION_CONTRACTS.md) for the exact request and response schemas for each tool.

---

## Step 3 - (Optional) REST API Connector

For Power Automate flows or non-MCP action steps, create a custom connector in Power Platform using [docs/CATALOG_REST_API.openapi.json](docs/CATALOG_REST_API.openapi.json). Use the same OAuth 2.0 credentials as the MCP connector.

Operations needed: SearchCatalogItems, GetCatalogItemForm, PlaceCatalogOrder

---

## Troubleshooting

### "Failed to login. Could not discover authorization server metadata"

Power Platform caches OIDC metadata when the connection is first created. If ENTRA_* variables were missing at that time, the cached metadata is empty/stale and login fails silently.

**Fix - delete and recreate the connection:**

1. Copilot Studio > **Tools** > ServiceNow MCP > **Remove**
2. **Settings > Connections** > delete the ServiceNow MCP entry
3. Power Platform Admin Center > confirm the connector is removed
4. Re-add the tool from scratch (Step 1 above)

Do this any time you change ENTRA_* configuration after the connection was first created.

### Connection popup closes instantly (no Entra login page appears)

1. Verify ENTRA_TENANT_ID, ENTRA_CLIENT_ID, ENTRA_CLIENT_SECRET are set in Function App application settings.
2. Confirm OIDC discovery returns 200:
   GET https://your-function-app.azurewebsites.net/.well-known/openid-configuration
3. Confirm unauthenticated POST /mcp returns 401 with a WWW-Authenticate header containing resource_metadata.

### Copilot Studio in a different Entra tenant than the Function App

1. Change the app registration Supported account types to Accounts in any organizational directory (Multi-tenant).
2. Add the Copilot Studio tenant to the trusted list:
   azd env set ENTRA_TRUSTED_TENANT_IDS "copilot-studio-tenant-guid"
   azd deploy
3. Have an admin in the Copilot Studio tenant grant consent:
   https://login.microsoftonline.com/TENANT_ID/adminconsent?client_id=ENTRA_CLIENT_ID

### Tools not visible after adding the connection

- Verify the function app is running (check Application Insights).
- Ensure the MCP URL has no trailing slash.
- Delete and recreate the connection.