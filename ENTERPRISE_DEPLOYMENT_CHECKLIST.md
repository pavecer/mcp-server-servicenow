# Enterprise Deployment Checklist — ServiceNow MCP Server

This checklist covers everything an enterprise team needs to deploy, configure, and validate the ServiceNow MCP Server in a production tenant. It is split into three sequential parts: **Azure Deployment**, **ServiceNow Setup**, and **Microsoft Copilot Studio Setup**. A **Troubleshooting Guide** follows at the end.

Work through each part in order. Each part includes a **Required Roles** section listing who must be involved before any steps begin.

---

## Table of Contents

1. [Part 1 — Azure Deployment](#part-1--azure-deployment)
   - [1.1 Required Roles](#11-required-roles)
   - [1.2 Prerequisites](#12-prerequisites)
   - [1.3 Create the Entra ID App Registration](#13-create-the-entra-id-app-registration)
   - [1.4 Prepare the Deployment Machine](#14-prepare-the-deployment-machine)
   - [1.5 Deploy the Azure Infrastructure & Function App](#15-deploy-the-azure-infrastructure--function-app)
   - [1.6 Post-Deployment Validation](#16-post-deployment-validation)
   - [1.7 Azure Part Checklist](#17-azure-part-checklist)
2. [Part 2 — ServiceNow Setup](#part-2--servicenow-setup)
   - [2.1 Required Roles](#21-required-roles)
   - [2.2 Create an OAuth Application Registry Entry](#22-create-an-oauth-application-registry-entry)
   - [2.3 Create a Dedicated Integration User](#23-create-a-dedicated-integration-user)
   - [2.4 Assign Required Roles to the Integration User](#24-assign-required-roles-to-the-integration-user)
   - [2.5 Note Down the ServiceNow Credentials](#25-note-down-the-servicenow-credentials)
   - [2.6 ServiceNow Part Checklist](#26-servicenow-part-checklist)
3. [Part 3 — Microsoft Copilot Studio Setup](#part-3--microsoft-copilot-studio-setup)
   - [3.1 Required Roles](#31-required-roles)
   - [3.2 Grant Admin Consent (same-tenant)](#32-grant-admin-consent-same-tenant)
   - [3.3 Grant Admin Consent (cross-tenant scenario)](#33-grant-admin-consent-cross-tenant-scenario)
   - [3.4 Add the MCP Tool to a Copilot Studio Agent](#34-add-the-mcp-tool-to-a-copilot-studio-agent)
   - [3.5 Verify End-to-End Flow](#35-verify-end-to-end-flow)
   - [3.6 Copilot Studio Part Checklist](#36-copilot-studio-part-checklist)
4. [Troubleshooting Guide](#troubleshooting-guide)

---

## Part 1 — Azure Deployment

### 1.1 Required Roles

The following roles **must** be held by the person (or service principal) performing the deployment. Confirm these are granted **before** starting.

#### Mandatory Azure Roles

| Role | Scope | Why it is needed |
|---|---|---|
| **Contributor** | Target subscription or resource group | Create and configure all Azure resources (Function App, Key Vault, Storage, App Insights, Log Analytics) |
| **User Access Administrator** | Target subscription or resource group | Assign RBAC roles to the Function App's managed identity (Storage Blob Data Owner, Key Vault Secrets User) |

> **Tip**: If your organization does not allow assigning both Contributor and User Access Administrator to one person, a **subscription Owner** role covers both. Alternatively, create a custom role that combines `Microsoft.Authorization/roleAssignments/write` with the standard Contributor permissions.

#### Mandatory Entra ID Roles

| Role | Why it is needed |
|---|---|
| **Application Administrator** *or* **Cloud Application Administrator** | Register and fully configure the Entra ID app registration (create the app, expose an API scope, add redirect URIs, create a client secret, configure multi-tenant support) |

> **Admin-level note**: If your organization enforces admin consent for all API permissions, a **Global Administrator** or **Privileged Role Administrator** must also be available to grant tenant-wide admin consent in the final step.

---

### 1.2 Prerequisites

Install all tools on the machine that will run the deployment. Verify each version before continuing.

| Tool | Minimum Version | Install |
|---|---|---|
| **Node.js** | 20.x LTS | https://nodejs.org |
| **npm** | bundled with Node.js | — |
| **Azure CLI** (`az`) | 2.55+ | https://learn.microsoft.com/cli/azure/install-azure-cli |
| **Azure Developer CLI** (`azd`) | 1.9+ | https://learn.microsoft.com/azure/developer/azure-developer-cli/install-azd |
| **PowerShell** | 7+ (cross-platform) | https://learn.microsoft.com/powershell/scripting/install/installing-powershell |
| **Git** | any recent | https://git-scm.com |

**Verify installs:**

```powershell
node --version        # must be v20.x
az version            # must be 2.55+
azd version           # must be 1.9+
pwsh --version        # must be 7+
```

**Clone the repository:**

```powershell
git clone https://github.com/pavecer/mcp-server-servicenow.git
cd mcp-server-servicenow
npm install
```

---

### 1.3 Create the Entra ID App Registration

This app registration is the OAuth 2.0 identity used by Copilot Studio to authenticate against the MCP server. Complete these steps **before** deploying Azure resources — you need the resulting IDs to configure the deployment.

#### Step 1 — Register the application

1. Open the [Azure Portal](https://portal.azure.com) and navigate to **Microsoft Entra ID → App registrations → New registration**.
2. Fill in:
   - **Name**: `ServiceNow MCP Server` (or your naming convention)
   - **Supported account types**:
     - **Same tenant only**: Choose `Accounts in this organizational directory only (Single tenant)`.
     - **Cross-tenant** (Copilot Studio in a different tenant): Choose `Accounts in any organizational directory (Any Microsoft Entra ID tenant - Multitenant)`.
   - **Redirect URI**: Leave blank for now.
3. Click **Register**.
4. On the Overview page, copy and save:
   - **Application (client) ID** → this is `ENTRA_CLIENT_ID`
   - **Directory (tenant) ID** → this is `ENTRA_TENANT_ID`

#### Step 2 — Create a client secret

1. In the app registration, navigate to **Certificates & secrets → Client secrets → New client secret**.
2. Enter a description (e.g., `MCP Server Production`) and set an expiry that matches your rotation policy (maximum 24 months).
3. Click **Add**.
4. **Copy the secret Value immediately** — it is shown only once. This is `ENTRA_CLIENT_SECRET`.

> **Security note**: Store this secret in a password manager or directly in Azure Key Vault. Do not paste it into source code or plain-text files.

#### Step 3 — Expose an API scope

1. In the app registration, navigate to **Expose an API**.
2. Click **Set** next to **Application ID URI** and accept the default `api://<ENTRA_CLIENT_ID>`. Click **Save**. This value is your `ENTRA_AUDIENCE`.
3. Click **Add a scope** and fill in:
   - **Scope name**: `access_as_user`
   - **Who can consent**: `Admins and users`
   - **Admin consent display name**: `Access ServiceNow MCP as user`
   - **Admin consent description**: `Allows Copilot Studio to access the ServiceNow MCP Server on behalf of the signed-in user.`
   - **User consent display name**: `Access ServiceNow MCP as you`
   - **User consent description**: `Allow Copilot Studio to access ServiceNow MCP on your behalf`
   - **State**: Enabled
4. Click **Add scope**.

#### Step 4 — Configure redirect URIs

1. In the app registration, navigate to **Authentication → Add a platform → Web**.
2. Add the following redirect URIs:
   ```
   https://oauth.botframework.com/callback
   https://global.consent.azure-apim.net/redirect
   https://copilotstudio.preview.microsoft.com/connection/oauth/redirect
   ```
   Additionally, add the connector-specific redirect URI for this connector:
   ```
   https://global.consent.azure-apim.net/redirect/cr7a3-5fservicenow-20mcp-5f635855ea92fead22
   ```
3. Under **Implicit grant and hybrid flows**, check both:
   - ✅ **Access tokens**
   - ✅ **ID tokens**
4. Click **Save**.

> **Note on connector-specific redirect URIs**: The URI ending in `635855ea92fead22` is the published connector identifier for this repository. Power Platform may send this exact URI, or a different connector-specific URI, during the first OAuth flow. If login fails with a redirect URI mismatch error (`AADSTS50011`), inspect the `authorize` request in your browser's Network tab to find the exact `redirect_uri` parameter being used, then register that URI in the app registration. See the [Redirect URI mismatch troubleshooting entry](#-redirect-uri-mismatch-aadsts50011-during-entra-login) for details.

#### Step 5 — Set token version to v2

1. In the app registration, navigate to **Manifest**.
2. Find the `"api"` section and ensure `"requestedAccessTokenVersion"` is set to `2`:
   ```json
   "api": {
     "requestedAccessTokenVersion": 2,
     ...
   }
   ```
3. Click **Save**.

---

### 1.4 Prepare the Deployment Machine

#### Step 1 — Log in to Azure

```powershell
# Replace with your target tenant and subscription IDs
az login --tenant <ENTRA_TENANT_ID>
az account set --subscription <AZURE_SUBSCRIPTION_ID>

# Verify the correct subscription is active
az account show --output table
```

If your organization enforces Conditional Access (MFA with claims challenges), include `--claims-challenge`:

```powershell
az login --tenant <ENTRA_TENANT_ID> --claims-challenge "<CLAIMS_CHALLENGE_VALUE>"
```

#### Step 2 — Log in to Azure Developer CLI

```powershell
azd auth login --tenant-id <ENTRA_TENANT_ID>
azd config set auth.useAzCliAuth true
```

#### Step 3 — Create the azd environment

```powershell
# Choose a short, lowercase environment name (e.g., "prod", "dev", "test")
azd env new <ENV_NAME> --no-prompt
```

If the environment already exists:

```powershell
azd env select <ENV_NAME>
```

#### Step 4 — Set infrastructure parameters

These values are written into the Bicep parameter file (`.azure/<ENV_NAME>/config.json`). They must be set here — not only in `.env` — or the deployed Azure resources will be missing the ServiceNow and Entra configuration.

```powershell
# Core azd settings
azd env set AZURE_LOCATION "westeurope"         # or your preferred Azure region
azd env set AZURE_SUBSCRIPTION_ID "<AZURE_SUBSCRIPTION_ID>"
azd env set AZURE_TENANT_ID "<ENTRA_TENANT_ID>"

# ServiceNow (required)
azd env config set infra.parameters.serviceNowInstanceUrl    "https://<YOUR_INSTANCE>.service-now.com"
azd env config set infra.parameters.serviceNowClientId       "<SERVICENOW_CLIENT_ID>"
azd env config set infra.parameters.serviceNowClientSecret   "<SERVICENOW_CLIENT_SECRET>"

# ServiceNow integration user (required for password-grant OAuth; recommended over client-credentials)
azd env config set infra.parameters.serviceNowUsername       "<SERVICENOW_INTEGRATION_USER>"
azd env config set infra.parameters.serviceNowPassword       "<SERVICENOW_INTEGRATION_PASSWORD>"

# Entra ID (required for Copilot Studio OAuth)
azd env config set infra.parameters.entraTenantId            "<ENTRA_TENANT_ID>"
azd env config set infra.parameters.entraClientId            "<ENTRA_CLIENT_ID>"
azd env config set infra.parameters.entraClientSecret        "<ENTRA_CLIENT_SECRET>"
azd env config set infra.parameters.entraAudience            "api://<ENTRA_CLIENT_ID>"

# Cross-tenant support (set if Copilot Studio runs in a different Entra tenant)
# Choose ONE of the two options below:

# Option A — explicit trusted tenant list (recommended for production):
azd env config set infra.parameters.entraTrustedTenantIds    "<COPILOT_STUDIO_TENANT_ID>"
azd env config set infra.parameters.entraAllowAnyTenant      "false"

# Option B — accept tokens from any Microsoft tenant (dev/test ONLY; do NOT use in production):
# azd env config set infra.parameters.entraAllowAnyTenant    "true"
```

---

### 1.5 Deploy the Azure Infrastructure & Function App

#### Option A — Automated script (recommended)

```powershell
pwsh -File scripts/deploy-azure.ps1 `
  -EnvironmentName "<ENV_NAME>" `
  -Location "westeurope" `
  -SubscriptionId "<AZURE_SUBSCRIPTION_ID>" `
  -ServiceNowInstanceUrl "https://<YOUR_INSTANCE>.service-now.com" `
  -ServiceNowClientId "<SERVICENOW_CLIENT_ID>" `
  -ServiceNowClientSecret "<SERVICENOW_CLIENT_SECRET>" `
  -ServiceNowUsername "<SERVICENOW_USERNAME>" `
  -ServiceNowPassword "<SERVICENOW_PASSWORD>" `
  -EntraTenantId "<ENTRA_TENANT_ID>" `
  -EntraClientId "<ENTRA_CLIENT_ID>" `
  -EntraClientSecret "<ENTRA_CLIENT_SECRET>" `
  -EntraAudience "api://<ENTRA_CLIENT_ID>"
```

#### Option B — Manual step-by-step

```powershell
npm run build
azd up --no-prompt
```

After deployment completes, note the outputs:

```powershell
azd env get-value MCP_ENDPOINT_URL     # e.g. https://func-xxxxx.azurewebsites.net/mcp
azd env get-value FUNCTION_APP_NAME    # e.g. func-xxxxx
azd env get-value AZURE_RESOURCE_GROUP # e.g. rg-myenv-westeurope
azd env get-value KEY_VAULT_NAME       # e.g. kv-xxxxx
```

#### What gets deployed

| Azure Resource | Purpose |
|---|---|
| **Resource Group** | Container for all resources |
| **Azure Functions (Flex Consumption FC1)** | Hosts the MCP server on Node.js 20 |
| **Storage Account** | Deployment packages for Flex Consumption |
| **Azure Key Vault** | Stores ServiceNow client secret, password, and Entra client secret |
| **Application Insights** | Request traces, errors, and performance metrics |
| **Log Analytics Workspace** | Centralized log store (30-day retention) |

#### RBAC role assignments created automatically by the Bicep template

| Identity | Role | Scope |
|---|---|---|
| Function App managed identity | **Storage Blob Data Owner** | Storage account |
| Function App managed identity | **Key Vault Secrets User** | Key Vault |

These are created by `infra/main.bicep` during provisioning. If provisioning fails with an authorization error, confirm the deploying user has `User Access Administrator` or `Owner` on the resource group.

---

### 1.6 Post-Deployment Validation

Run all checks from the deployment machine (or a browser) before moving to Part 2.

#### Step 1 — Verify Azure Function routes

```powershell
$rg   = (azd env get-value AZURE_RESOURCE_GROUP).Trim()
$func = (azd env get-value FUNCTION_APP_NAME).Trim()

az functionapp function list `
  --resource-group $rg `
  --name $func `
  --query "[].{name:name}" `
  --output table
```

Expected function names: `mcp`, `oidc-discovery` (or similar — the important thing is that the routes `/mcp` and `/.well-known/openid-configuration` are accessible at the next step).

#### Step 2 — Verify Entra environment variables are populated

```powershell
az functionapp config appsettings list `
  --resource-group $rg `
  --name $func `
  --query "[?starts_with(name, 'ENTRA_')].[name,value]" `
  --output table
```

All ENTRA_* rows must have non-empty values. If any are blank, re-run `azd up` after confirming the `infra.parameters` values from Section 1.4, Step 4 are set.

#### Step 3 — Test OIDC discovery endpoints

```powershell
$base = "https://$func.azurewebsites.net"

# All three must return HTTP 200
Invoke-WebRequest "$base/.well-known/openid-configuration"  -Method GET | Select-Object StatusCode
Invoke-WebRequest "$base/.well-known/oauth-authorization-server" -Method GET | Select-Object StatusCode
Invoke-WebRequest "$base/.well-known/oauth-protected-resource"  -Method GET | Select-Object StatusCode
```

The `openid-configuration` response must include:
- `issuer`
- `authorization_endpoint`
- `token_endpoint`
- `registration_endpoint` (present when `ENTRA_CLIENT_SECRET` is set)

#### Step 4 — Test MCP unauthenticated challenge

```powershell
$response = Invoke-WebRequest `
  -Uri "$base/mcp" `
  -Method POST `
  -ContentType "application/json" `
  -Body '{}' `
  -SkipHttpErrorCheck

$response.StatusCode                          # must be 401
$response.Headers["WWW-Authenticate"]         # must contain resource_metadata=
```

#### Step 5 — Run the smoke test

```powershell
$env:MCP_ENDPOINT_URL = (azd env get-value MCP_ENDPOINT_URL).Trim()
$env:FUNCTION_KEY     = (az functionapp function keys list `
  --resource-group $rg --name $func `
  --function-name mcp --output json | ConvertFrom-Json).default
$env:SEARCH_QUERY     = "laptop"

node scripts/smoke-test.mjs
```

A passing smoke test confirms the MCP protocol layer, ServiceNow OAuth, and catalog API access all work correctly.

---

### 1.7 Azure Part Checklist

```
Pre-deployment
  - [ ] Entra App Administrator (or Global Admin) role confirmed
  - [ ] Azure Contributor + User Access Administrator role confirmed on target subscription/RG
  - [ ] Node.js 20, Azure CLI, azd, PowerShell 7 installed and verified
  - [ ] Repository cloned and npm install completed

Entra App Registration
  - [ ] App registered (single-tenant or multi-tenant as needed)
  - [ ] Client secret created and saved securely
  - [ ] Application ID URI set to api://<ENTRA_CLIENT_ID>
  - [ ] Scope access_as_user added
  - [ ] All four redirect URIs added
  - [ ] ID tokens and Access tokens enabled under Implicit grant
  - [ ] requestedAccessTokenVersion = 2 in manifest

Deployment
  - [ ] az login and azd auth login completed for correct tenant
  - [ ] azd environment created/selected
  - [ ] infra.parameters for ServiceNow set (instanceUrl, clientId, clientSecret)
  - [ ] infra.parameters for ServiceNow user set (username, password)
  - [ ] infra.parameters for Entra set (tenantId, clientId, clientSecret, audience)
  - [ ] infra.parameters for cross-tenant set if applicable
  - [ ] npm run build succeeded
  - [ ] azd up succeeded
  - [ ] MCP_ENDPOINT_URL, FUNCTION_APP_NAME noted

Post-deployment validation
  - [ ] ENTRA_* app settings are non-empty
  - [ ] /.well-known/openid-configuration returns HTTP 200
  - [ ] /.well-known/oauth-authorization-server returns HTTP 200
  - [ ] /.well-known/oauth-protected-resource returns HTTP 200
  - [ ] POST /mcp without token returns HTTP 401 with WWW-Authenticate resource_metadata
  - [ ] Smoke test passes
```

---

## Part 2 — ServiceNow Setup

### 2.1 Required Roles

The following roles must be held in ServiceNow before configuration begins.

#### Mandatory ServiceNow Roles

| Role | Why it is needed |
|---|---|
| **`admin`** *or* **`oauth_admin`** | Create and manage OAuth application registry entries (Application Registry) |
| **`admin`** *or* **`user_admin`** | Create new user accounts and assign roles |
| **`admin`** *or* **`catalog_admin`** | Verify Service Catalog item visibility for the integration user |

> **Recommendation for least-privilege**: If your organization restricts the `admin` role, delegate `oauth_admin` for Step 2.2 and `user_admin` for Step 2.3. A ServiceNow administrator can verify catalog access separately.

#### Admin-Level Requirement

Creating an OAuth application in the Application Registry requires either the `admin` role or the `oauth_admin` role. In most enterprise ServiceNow instances, this means involving your **ServiceNow System Administrator** or a member of the **Platform Team**.

---

### 2.2 Create an OAuth Application Registry Entry

This creates the OAuth 2.0 client (Client ID + Client Secret) that the Azure Function uses to obtain tokens from ServiceNow.

#### Step 1 — Open the Application Registry

1. In ServiceNow, navigate to **System OAuth → Application Registry** (search `Application Registry` in the navigation filter).
2. Click **New**.

#### Step 2 — Choose OAuth type

Select **Create an OAuth API endpoint for external clients** and click **Submit**.

#### Step 3 — Fill in the application details

| Field | Value |
|---|---|
| **Name** | `ServiceNow MCP Server` (or your naming convention) |
| **Client ID** | Auto-generated — copy and save this as `SERVICENOW_CLIENT_ID` |
| **Client Secret** | Click the lock icon to view — copy and save this as `SERVICENOW_CLIENT_SECRET` |
| **Accessible from** | `All application scopes` |
| **Active** | ✅ Checked |
| **Refresh Token Lifespan** | `8,640,000` (100 days) — adjust per your security policy |
| **Access Token Lifespan** | `1,800` (30 minutes) — the MCP server caches and refreshes automatically |
| **Redirect URL** | `https://<FUNCTION_APP_NAME>.azurewebsites.net/oauth/callback` (the server does not use this endpoint but ServiceNow requires a value) |

Click **Submit** to save.

> **Note on Client Secret**: After saving, re-open the record and click the lock icon next to **Client Secret** to reveal the value. Copy it immediately — it is masked in the UI.

#### Step 4 — Verify the OAuth endpoint

Confirm the token endpoint is accessible:

```
https://<YOUR_INSTANCE>.service-now.com/oauth_token.do
```

This URL is the value for `SERVICENOW_OAUTH_TOKEN_PATH` (default: `/oauth_token.do`). No change is needed unless your instance uses a custom path.

---

### 2.3 Create a Dedicated Integration User

Create a dedicated non-personal service account. This user's credentials are used by the MCP server to authenticate with ServiceNow on behalf of all Copilot Studio users.

#### Step 1 — Create the user

1. Navigate to **System Security → Users** (or search `Users`).
2. Click **New** and fill in:

| Field | Value |
|---|---|
| **User ID** | `svc_mcp_integration` (your naming convention) |
| **First name** | `MCP` |
| **Last name** | `Integration` |
| **Email** | `svc-mcp-integration@your-domain.com` |
| **Password** | Strong random password — save as `SERVICENOW_PASSWORD` |
| **Active** | ✅ Checked |
| **Web service access only** | ✅ Checked (prevents UI login, reduces attack surface) |
| **Password needs reset** | ☐ Unchecked |

3. Click **Submit**.
4. Note the **User ID** — save as `SERVICENOW_USERNAME`.

---

### 2.4 Assign Required Roles to the Integration User

The integration user needs the minimum set of roles to call the Service Catalog REST API. Assign only what is listed below and nothing more (principle of least privilege).

#### Mandatory roles

| Role | Why it is needed |
|---|---|
| **`catalog`** | Read access to Service Catalog items (`/api/sn_sc/servicecatalog/items`) |
| **`catalog_user`** | Submit orders through the Service Catalog (`/api/sn_sc/servicecatalog/items/{sys_id}/order_now`) |

#### How to assign roles

1. Open the integration user record (**System Security → Users → svc_mcp_integration**).
2. Scroll to the **Roles** related list at the bottom of the form.
3. Click **Edit** and add both `catalog` and `catalog_user`.
4. Click **Save**.

#### Optional role for diagnostics

| Role | When to add |
|---|---|
| **`itil`** | Only if your catalog items require ITIL permissions to view or order. Add temporarily when diagnosing "item not found" errors, then remove if not necessary. |

> **Security guidance**: Do **not** assign `admin` to this service account. The `catalog` and `catalog_user` roles provide the exact permissions the MCP server needs.

---

### 2.5 Note Down the ServiceNow Credentials

Before leaving the ServiceNow configuration, confirm you have all four values:

| Variable | Value |
|---|---|
| `SERVICENOW_INSTANCE_URL` | `https://<YOUR_INSTANCE>.service-now.com` |
| `SERVICENOW_CLIENT_ID` | OAuth application Client ID from Step 2.2 |
| `SERVICENOW_CLIENT_SECRET` | OAuth application Client Secret from Step 2.2 |
| `SERVICENOW_USERNAME` | Integration user ID from Step 2.3 |
| `SERVICENOW_PASSWORD` | Integration user password from Step 2.3 |

These values must be present in the Azure Function App configuration (either set during `azd up` via `infra.parameters` or patched afterwards via `az functionapp config appsettings set`).

---

### 2.6 ServiceNow Part Checklist

```
Roles confirmed
  - [ ] ServiceNow admin or oauth_admin available to create OAuth application
  - [ ] ServiceNow admin or user_admin available to create user and assign roles
  - [ ] Catalog admin available to verify item visibility

OAuth Application Registry
  - [ ] Application registry entry created
  - [ ] SERVICENOW_CLIENT_ID copied and saved
  - [ ] SERVICENOW_CLIENT_SECRET copied and saved
  - [ ] Access and Refresh Token lifespans configured per security policy
  - [ ] Application is Active

Integration User
  - [ ] Dedicated service account created (not a personal account)
  - [ ] Web service access only enabled
  - [ ] SERVICENOW_USERNAME and SERVICENOW_PASSWORD saved
  - [ ] catalog role assigned
  - [ ] catalog_user role assigned
  - [ ] No admin role assigned (least-privilege)

Verification
  - [ ] All five SERVICENOW_* values collected
  - [ ] Azure Function app settings updated with ServiceNow values (if deployed before this step)
  - [ ] validate_servicenow_configuration MCP tool returns success (tested after Part 1 and Part 2 complete)
```

---

## Part 3 — Microsoft Copilot Studio Setup

### 3.1 Required Roles

#### Mandatory Power Platform / Copilot Studio Roles

| Role | Why it is needed |
|---|---|
| **Environment Maker** (Power Platform) | Create and edit Copilot Studio agents, add tools, manage connections |
| **Copilot Studio user license** | Required to access and use Microsoft Copilot Studio |

#### Admin-Level Roles

| Role | Why it is needed |
|---|---|
| **Power Platform Admin** *or* **Global Admin** | Grant tenant-wide admin consent for the Entra app registration so individual users are not prompted to consent |
| **Entra ID Application Administrator** *or* **Global Admin** | Grant admin consent in the Entra portal (portal.azure.com → Entra ID → Enterprise Applications) |

> **Cross-tenant note**: If Copilot Studio runs in a **different Entra tenant** than the Azure Function App, a **Global Administrator** (or Privileged Role Administrator) of that remote tenant must perform admin consent. See Section 3.3.

---

### 3.2 Grant Admin Consent (same-tenant)

Granting admin consent prevents every end user from seeing an individual consent prompt when they first use the Copilot Studio agent.

#### Step 1 — Add API permission in the app registration

1. In [Azure Portal](https://portal.azure.com), open the Entra app registration (**Entra ID → App registrations → ServiceNow MCP Server**).
2. Navigate to **API permissions → Add a permission → My APIs**.
3. Select **ServiceNow MCP Server**.
4. Check `access_as_user` and click **Add permissions**.

#### Step 2 — Grant tenant-wide admin consent

1. Still on the **API permissions** page, click **Grant admin consent for \<your tenant\>**.
2. Click **Yes** when prompted.
3. Confirm the status column shows a green checkmark: **Granted for \<your tenant\>**.

---

### 3.3 Grant Admin Consent (cross-tenant scenario)

Skip this section if Copilot Studio runs in the **same** Entra tenant as the Azure Function App.

**Scenario**: Azure Function deployed in Tenant A, Copilot Studio used in Tenant B.

#### Requirements

- The Entra app registration in Tenant A must be set to **multi-tenant** (see Part 1, Step 1 — Supported account types).
- The `ENTRA_TRUSTED_TENANT_IDS` infra parameter must include the Tenant B GUID (set during Part 1).
- A **Global Administrator** of Tenant B must perform the following steps.

#### Step 1 — Construct the admin consent URL

```
https://login.microsoftonline.com/<TENANT_B_ID>/adminconsent?
  client_id=<ENTRA_CLIENT_ID>&
  redirect_uri=https://oauth.botframework.com/callback&
  scope=api://<ENTRA_CLIENT_ID>/access_as_user
```

Example:

```
https://login.microsoftonline.com/f8cdef31-a31b-4234-b2be-1234567890ab/adminconsent?client_id=44b3a088-05e3-4fcc-9216-d1b117ed489a&redirect_uri=https://oauth.botframework.com/callback&scope=api://44b3a088-05e3-4fcc-9216-d1b117ed489a/access_as_user
```

#### Step 2 — Admin opens the URL and approves

1. The Global Administrator of Tenant B opens the URL in a browser.
2. They are shown the consent dialog listing:
   - **App Name**: ServiceNow MCP Server
   - **Permission**: Access ServiceNow MCP as user
3. They click **Accept**.

#### Step 3 — Verify consent was granted

1. The Global Administrator navigates to [Azure Portal](https://portal.azure.com) (signed in to Tenant B).
2. Navigate to **Entra ID → Enterprise applications → ServiceNow MCP Server**.
3. Under **Permissions**, confirm the `access_as_user` permission shows **Granted by admin**.

---

### 3.4 Add the MCP Tool to a Copilot Studio Agent

#### Step 1 — Open Copilot Studio

1. Navigate to [https://copilotstudio.microsoft.com](https://copilotstudio.microsoft.com).
2. Sign in with your Microsoft 365 / Entra account.
3. Select the correct **Power Platform environment** from the environment picker (top-right).

#### Step 2 — Open or create an agent

- **New agent**: Click **Create** → follow the wizard.
- **Existing agent**: Open the agent from the Agents list.

#### Step 3 — Add the ServiceNow MCP tool

1. In the agent editor, click **Tools** (left navigation) → **Add a tool**.
2. Select **Model Context Protocol**.
3. Fill in the form:

| Field | Value |
|---|---|
| **Server name** | `ServiceNow MCP` |
| **Server URL** | `https://<FUNCTION_APP_NAME>.azurewebsites.net/mcp` |
| **Authentication** | `OAuth 2.0` |
| **Type** | `Dynamic discovery` |

4. Click **Create**.

Copilot Studio automatically fetches `/.well-known/openid-configuration` and configures the OAuth endpoints. This caches the OAuth metadata — **do not close or retry** until the dialog completes successfully.

#### Step 4 — Sign in to the connection

1. After the tool is created, Copilot Studio prompts you to sign in.
2. Click **Sign in** and authenticate with your Entra account (the account must be in the trusted tenant).
3. On the consent screen, click **Accept** if prompted.
4. The connection should show a green status.

#### Step 5 — Test the tool in the agent

1. In the agent editor, open the **Test** panel (top-right).
2. Type a message such as:
   - *"Search for a laptop in the service catalog"*
   - *"Show me available software requests"*
3. Verify the agent calls the MCP tool and returns ServiceNow catalog results.

---

### 3.5 Verify End-to-End Flow

Once all three parts are complete, perform this full end-to-end test.

1. In Copilot Studio Test panel: type `search for laptop`.
2. Expected: Agent calls `search_catalog_items`, returns a list of items.
3. Type: `show me the form for the first item`.
4. Expected: Agent calls `get_catalog_item_form`, returns an Adaptive Card form.
5. Fill in form fields and confirm the order.
6. Expected: Agent calls `place_order`, returns an Adaptive Card confirmation with a ServiceNow request number.

If any step fails, see the [Troubleshooting Guide](#troubleshooting-guide).

---

### 3.6 Copilot Studio Part Checklist

```
Roles confirmed
  - [ ] Environment Maker role in Power Platform confirmed for setup user
  - [ ] Copilot Studio license available
  - [ ] Power Platform Admin or Global Admin available to grant admin consent

Admin Consent (same-tenant)
  - [ ] access_as_user permission added to app registration
  - [ ] Admin consent granted for the tenant

Admin Consent (cross-tenant only)
  - [ ] Entra app is configured as multi-tenant
  - [ ] ENTRA_TRUSTED_TENANT_IDS includes the remote tenant ID
  - [ ] Global Admin of remote tenant visited adminconsent URL
  - [ ] Enterprise Applications shows permission as "Granted by admin"

Copilot Studio Tool Setup
  - [ ] Correct Power Platform environment selected
  - [ ] MCP tool added with correct server URL (ending in /mcp)
  - [ ] Authentication set to OAuth 2.0 → Dynamic discovery
  - [ ] Connection sign-in completed successfully
  - [ ] Tool is visible in agent's Tools list with green status

End-to-End Test
  - [ ] search_catalog_items returns ServiceNow items
  - [ ] get_catalog_item_form returns a form
  - [ ] place_order returns a request number confirmation
```

---

## Troubleshooting Guide

### Azure / Deployment Issues

---

#### ❌ `azd up` fails with "Authorization failed" or "does not have authorization to perform action"

**Cause**: The deploying account lacks the `User Access Administrator` role, which is needed to create RBAC role assignments for the Function App's managed identity.

**Fix**:
1. Ask your Azure administrator to grant you `Owner` or `User Access Administrator` on the target subscription or resource group.
2. Alternatively, ask your administrator to run the RBAC role assignment steps manually:
   ```powershell
   # Get the principal ID of the function app's managed identity after provisioning
   $principalId = (az functionapp show -g <RG> -n <FUNC> --query "identity.principalId" -o tsv)

   # Storage Blob Data Owner
   az role assignment create --assignee $principalId \
     --role "ba92f5b4-2d11-453d-a403-e96b0029c9fe" \
     --scope "/subscriptions/<SUB>/resourceGroups/<RG>/providers/Microsoft.Storage/storageAccounts/<ST>"

   # Key Vault Secrets User
   az role assignment create --assignee $principalId \
     --role "4633458b-17de-408a-b874-0445c86b69e6" \
     --scope "/subscriptions/<SUB>/resourceGroups/<RG>/providers/Microsoft.KeyVault/vaults/<KV>"
   ```
3. Re-run `azd up`.

---

#### ❌ OIDC endpoints return `{"error":"Entra ID is not configured on this server"}`

**Cause**: The Azure Function is running without the `ENTRA_TENANT_ID` and `ENTRA_CLIENT_ID` environment variables. This happens when the values were set only in `.env` (the azd runtime environment) but not in `infra.parameters` (the Bicep deployment inputs).

**Fix**:
1. Set the missing infrastructure parameters:
   ```powershell
   azd env config set infra.parameters.entraTenantId    "<ENTRA_TENANT_ID>"
   azd env config set infra.parameters.entraClientId    "<ENTRA_CLIENT_ID>"
   azd env config set infra.parameters.entraClientSecret "<ENTRA_CLIENT_SECRET>"
   azd env config set infra.parameters.entraAudience    "api://<ENTRA_CLIENT_ID>"
   ```
2. Re-run `azd up`.
3. Verify the app settings are populated:
   ```powershell
   az functionapp config appsettings list \
     --resource-group <RG> --name <FUNC> \
     --query "[?starts_with(name,'ENTRA_')].[name,value]" \
     --output table
   ```

**Emergency runtime patch** (if re-deployment is not possible immediately):
```powershell
az functionapp config appsettings set \
  --resource-group <RG> --name <FUNC> \
  --settings \
    ENTRA_TENANT_ID="<ENTRA_TENANT_ID>" \
    ENTRA_CLIENT_ID="<ENTRA_CLIENT_ID>" \
    ENTRA_CLIENT_SECRET="<ENTRA_CLIENT_SECRET>" \
    ENTRA_AUDIENCE="api://<ENTRA_CLIENT_ID>"
```

---

#### ❌ `azd up` fails with `AADSTS50076` or "multi-factor authentication required"

**Cause**: Conditional Access policies in the target tenant require fresh MFA tokens.

**Fix**:
1. Re-authenticate, completing the MFA challenge:
   ```powershell
   az login --tenant <ENTRA_TENANT_ID>
   ```
2. If you receive a claims challenge error, include the `--claims-challenge` flag:
   ```powershell
   az login --tenant <ENTRA_TENANT_ID> --claims-challenge "<CLAIMS_CHALLENGE_VALUE>"
   ```
3. Re-run `azd auth login` and then `azd up`.

---

#### ❌ `azd up` cannot resolve or access the subscription

**Cause**: azd is authenticated to a different Entra tenant than the one that owns the subscription.

**Fix**:
```powershell
azd auth login --tenant-id <ENTRA_TENANT_ID>
azd env set AZURE_TENANT_ID "<ENTRA_TENANT_ID>"
azd env set AZURE_SUBSCRIPTION_ID "<AZURE_SUBSCRIPTION_ID>"
azd up --no-prompt
```

---

#### ❌ Key Vault secret reference not resolving (Function App shows `@Microsoft.KeyVault(...)` as literal value)

**Cause**: The Function App's managed identity has not yet been granted the `Key Vault Secrets User` role, or the role assignment has not propagated.

**Fix**:
1. Wait up to 10 minutes for RBAC propagation.
2. Verify the role assignment exists:
   ```powershell
   az role assignment list \
     --assignee <MANAGED_IDENTITY_PRINCIPAL_ID> \
     --role "4633458b-17de-408a-b874-0445c86b69e6" \
     --scope "/subscriptions/<SUB>/resourceGroups/<RG>/providers/Microsoft.KeyVault/vaults/<KV>"
   ```
3. If missing, create it manually (see the RBAC fix above).
4. Restart the Function App to force settings re-evaluation:
   ```powershell
   az functionapp restart --resource-group <RG> --name <FUNC>
   ```

---

### ServiceNow Issues

---

#### ❌ ServiceNow OAuth token request returns `401 Unauthorized` or `invalid_client`

**Cause**: The Client ID or Client Secret is incorrect, or the OAuth application record is not active.

**Fix**:
1. In ServiceNow, navigate to **System OAuth → Application Registry**.
2. Find the `ServiceNow MCP Server` entry.
3. Confirm it is **Active**.
4. Re-copy the Client Secret by clicking the lock icon — the visible value may have been masked after save.
5. Update the Azure Function App settings with the correct values:
   ```powershell
   az functionapp config appsettings set \
     --resource-group <RG> --name <FUNC> \
     --settings \
       SERVICENOW_CLIENT_ID="<CORRECT_CLIENT_ID>" \
       SERVICENOW_CLIENT_SECRET="<CORRECT_CLIENT_SECRET>"
   ```

---

#### ❌ ServiceNow OAuth token request returns `invalid_grant` or `User does not exist`

**Cause**: The `SERVICENOW_USERNAME` or `SERVICENOW_PASSWORD` is incorrect, or the integration user account is inactive.

**Fix**:
1. In ServiceNow, navigate to the integration user (**System Security → Users → svc_mcp_integration**).
2. Confirm the user is **Active**.
3. Reset the password if necessary and update `SERVICENOW_PASSWORD` in Azure.
4. Confirm **Web service access only** is checked (this user should not be able to log into the UI — but it does not block API access).

---

#### ❌ `search_catalog_items` returns empty results or `403 Forbidden`

**Cause**: The integration user lacks the `catalog` or `catalog_user` role, or the catalog items are in a restricted scope.

**Fix**:
1. In ServiceNow, open the integration user record.
2. In the **Roles** related list, confirm `catalog` and `catalog_user` are present.
3. If catalog items still do not appear, use the `validate_servicenow_configuration` MCP tool — it returns detailed permission diagnostics.
4. For restricted catalog items (e.g., visible only to certain groups), add the integration user to the relevant groups or adjust catalog item access controls.

---

#### ❌ `place_order` returns `403` or "User does not have access to submit requests"

**Cause**: The `catalog_user` role is missing from the integration user.

**Fix**: Assign the `catalog_user` role (see Part 2, Step 2.4). No other role is needed for basic order placement.

---

### Copilot Studio / Power Platform Issues

---

#### ❌ Copilot Studio: "Failed to login. Could not discover authorization server metadata"

**Cause**: Copilot Studio cannot reach or parse the OIDC discovery endpoint, **or** the connector was created when the OIDC endpoints were not yet returning valid JSON (Power Platform caches OAuth metadata at connector creation time — stale metadata causes this error).

**Fix**:
1. Verify all OIDC endpoints return HTTP 200:
   ```powershell
   Invoke-WebRequest "https://<FUNC>.azurewebsites.net/.well-known/openid-configuration" -Method GET
   Invoke-WebRequest "https://<FUNC>.azurewebsites.net/.well-known/oauth-authorization-server" -Method GET
   Invoke-WebRequest "https://<FUNC>.azurewebsites.net/.well-known/oauth-protected-resource" -Method GET
   ```
2. **Delete and recreate** the MCP connection in Copilot Studio:
   - In the agent editor: **Tools → [ServiceNow MCP tool] → Remove**.
   - In **Settings → Connections**: delete the `ServiceNow MCP` connection entry.
   - (If applicable) In **Power Platform Admin Center**: delete the connector.
3. Re-add the tool from scratch (Part 3, Section 3.4) — Power Platform will re-fetch and cache fresh OIDC metadata.

---

#### ❌ OAuth login popup closes immediately without showing the Entra sign-in page

**Cause**: Power Platform's consent proxy found no OAuth server information for this connector (stale or empty cache from an earlier failed setup).

**Diagnostics**:
1. Open Application Insights for the Function App.
2. Query for requests to `/.well-known/openid-configuration` during the exact window the popup was open.
3. If there are **no requests**, the connector has a stale empty cache — Power Platform never contacted the server.
4. If there are requests but they returned errors, fix the OIDC endpoint first.

**Fix**: Same as the previous item — delete and recreate the Copilot Studio connection.

---

#### ❌ Redirect URI mismatch (`AADSTS50011`) during Entra login

**Cause**: Power Platform sent a connector-specific redirect URI that is not registered in the Entra app registration.

**Fix**:
1. Open browser developer tools → Network tab.
2. When the login popup opens, find the `authorize` request to `login.microsoftonline.com`.
3. Note the exact `redirect_uri` parameter value.
4. In the Entra app registration (**Authentication → Web → Redirect URIs**), add that exact URI.
5. Save and retry.

---

#### ❌ Token issued by untrusted tenant (`403` or "Token issued by untrusted tenant")

**Cause**: A Copilot Studio user from a tenant that is not in `ENTRA_TRUSTED_TENANT_IDS` is trying to authenticate. This happens in cross-tenant deployments when the remote tenant ID was not configured.

**Fix**:
1. Identify the remote tenant ID from the error message or Azure Application Insights logs.
2. Add it to the configuration:
   ```powershell
   azd env config set infra.parameters.entraTrustedTenantIds "<REMOTE_TENANT_ID>"
   azd up --no-prompt
   ```
   Or patch immediately:
   ```powershell
   az functionapp config appsettings set \
     --resource-group <RG> --name <FUNC> \
     --settings ENTRA_TRUSTED_TENANT_IDS="<REMOTE_TENANT_ID>"
   ```

---

#### ❌ "Invalid audience" in token validation

**Cause**: The token's `aud` claim does not match the `ENTRA_AUDIENCE` setting. This happens when `ENTRA_AUDIENCE` is set to the raw client GUID but the token contains `api://<client-id>` (or vice versa).

**Fix**:
1. Confirm `ENTRA_AUDIENCE` in the Function App settings is set to `api://<ENTRA_CLIENT_ID>`.
2. Confirm the Entra app registration has the Application ID URI set to `api://<ENTRA_CLIENT_ID>` (Expose an API tab).
3. If you changed `ENTRA_AUDIENCE`, restart the Function App.

---

#### ❌ Copilot Studio agent calls the tool but returns no results (silent failure)

**Cause**: The ServiceNow OAuth token acquisition is failing silently, or the catalog returns empty results for the given query.

**Diagnostics**:
1. Use the `validate_servicenow_configuration` MCP tool in Copilot Studio or via a direct HTTP call.
2. Check Azure Application Insights for errors from the function execution.
3. Stream live logs:
   ```powershell
   az webapp log tail --resource-group <RG> --name <FUNC>
   ```

---

#### ❌ Connection shows as disconnected after a period of time

**Cause**: The Entra client secret has expired, or the Power Platform connection token has expired.

**Fix**:
1. In Copilot Studio: **Settings → Connections → ServiceNow MCP** → click **Fix connection** and sign in again.
2. If the client secret has expired, create a new one in the Entra app registration, update `ENTRA_CLIENT_SECRET` in the Function App, and recreate the connection.

---

### Diagnostic Commands Quick Reference

```powershell
# Stream Function App logs
az webapp log tail --resource-group <RG> --name <FUNC>

# Check all app settings
az functionapp config appsettings list --resource-group <RG> --name <FUNC> --output table

# Verify OIDC endpoint
Invoke-WebRequest "https://<FUNC>.azurewebsites.net/.well-known/openid-configuration" | ConvertFrom-Json

# Test MCP 401 challenge
$r = Invoke-WebRequest "https://<FUNC>.azurewebsites.net/mcp" -Method POST `
     -ContentType "application/json" -Body '{}' -SkipHttpErrorCheck
$r.StatusCode; $r.Headers["WWW-Authenticate"]

# Run smoke test
$env:MCP_ENDPOINT_URL = "https://<FUNC>.azurewebsites.net/mcp"
$env:FUNCTION_KEY = "<FUNCTION_KEY>"
$env:SEARCH_QUERY = "laptop"
node scripts/smoke-test.mjs

# Restart Function App (after config changes)
az functionapp restart --resource-group <RG> --name <FUNC>

# Check Key Vault role assignments for managed identity
az role assignment list \
  --assignee <MANAGED_IDENTITY_PRINCIPAL_ID> \
  --role "4633458b-17de-408a-b874-0445c86b69e6" \
  --output table
```

---

### Application Insights — Useful KQL Queries

Access Application Insights via **Azure Portal → Application Insights → Logs**.

```kql
// All failed requests in the last hour
requests
| where timestamp > ago(1h)
| where success == false
| project timestamp, name, resultCode, duration, url
| order by timestamp desc

// Token validation errors
traces
| where timestamp > ago(1h)
| where message has "token" or message has "Entra" or message has "401"
| project timestamp, message, severityLevel
| order by timestamp desc

// OIDC discovery endpoint calls
requests
| where timestamp > ago(1h)
| where url has ".well-known"
| project timestamp, url, resultCode, duration
| order by timestamp desc

// ServiceNow API errors
traces
| where timestamp > ago(1h)
| where message has "ServiceNow" or message has "servicenow"
| project timestamp, message, severityLevel
| order by timestamp desc
```

---

*For questions about the implementation, refer to the other documentation files in this repository: [README.md](README.md), [CROSS_TENANT_OAUTH_SETUP.md](CROSS_TENANT_OAUTH_SETUP.md), [COPILOT_STUDIO_SETUP.md](COPILOT_STUDIO_SETUP.md), and [AGENT_FIRST_TIME_DEPLOYMENT_RUNBOOK.md](AGENT_FIRST_TIME_DEPLOYMENT_RUNBOOK.md).*
