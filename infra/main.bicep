targetScope = 'resourceGroup'

// ---------------------------------------------------------------------------
// Parameters
// ---------------------------------------------------------------------------

@minLength(1)
@maxLength(64)
@description('Name of the azd environment (used to generate unique resource names).')
param environmentName string

@description('Azure region for all resources.')
param location string = resourceGroup().location

@description('ServiceNow instance URL, e.g. https://your-instance.service-now.com')
param serviceNowInstanceUrl string

@description('ServiceNow OAuth client ID.')
param serviceNowClientId string

@description('ServiceNow OAuth client secret.')
@secure()
param serviceNowClientSecret string

@description('ServiceNow integration user username (for password grant).')
param serviceNowUsername string = ''

@description('ServiceNow integration user password (for password grant).')
@secure()
param serviceNowPassword string = ''

@description('Entra tenant ID for OAuth 2.0 authentication (optional).')
param entraTenantId string = ''

@description('Entra application client ID for OAuth 2.0 authentication (optional).')
param entraClientId string = ''

@description('Entra application client secret for DCR (optional).')
@secure()
param entraClientSecret string = ''

@description('Expected audience override in Entra tokens (optional; defaults to entraClientId).')
param entraAudience string = ''

@description('Comma-separated list of trusted Entra tenant IDs for cross-tenant token validation (optional).')
param entraTrustedTenantIds string = ''

@description('Allow tokens from any Entra tenant (true/false). Keep false for production unless explicitly required.')
param entraAllowAnyTenant string = 'false'

// ---------------------------------------------------------------------------
// Variables
// ---------------------------------------------------------------------------

var resourceToken = toLower(uniqueString(subscription().id, environmentName, location))
var tags = { 'azd-env-name': environmentName }
var keyVaultName = 'kv-${resourceToken}'

// ---------------------------------------------------------------------------
// Log Analytics Workspace
// ---------------------------------------------------------------------------

resource logWorkspace 'Microsoft.OperationalInsights/workspaces@2022-10-01' = {
  name: 'log-${resourceToken}'
  location: location
  tags: tags
  properties: {
    sku: { name: 'PerGB2018' }
    retentionInDays: 30
  }
}

// ---------------------------------------------------------------------------
// Application Insights
// ---------------------------------------------------------------------------

resource appInsights 'Microsoft.Insights/components@2020-02-02' = {
  name: 'appi-${resourceToken}'
  location: location
  tags: tags
  kind: 'web'
  properties: {
    Application_Type: 'web'
    WorkspaceResourceId: logWorkspace.id
  }
}

// ---------------------------------------------------------------------------
// Key Vault
// ---------------------------------------------------------------------------

resource keyVault 'Microsoft.KeyVault/vaults@2023-07-01' = {
  name: keyVaultName
  location: location
  tags: tags
  properties: {
    tenantId: tenant().tenantId
    sku: {
      family: 'A'
      name: 'standard'
    }
    enableRbacAuthorization: true
    enabledForDeployment: false
    enabledForTemplateDeployment: false
    enabledForDiskEncryption: false
    publicNetworkAccess: 'Enabled'
  }
}

resource serviceNowClientSecretKeyVaultSecret 'Microsoft.KeyVault/vaults/secrets@2023-07-01' = {
  parent: keyVault
  name: 'servicenow-client-secret'
  properties: {
    value: serviceNowClientSecret
  }
}

resource serviceNowPasswordKeyVaultSecret 'Microsoft.KeyVault/vaults/secrets@2023-07-01' = if (!empty(serviceNowPassword)) {
  parent: keyVault
  name: 'servicenow-password'
  properties: {
    value: serviceNowPassword
  }
}

resource entraClientSecretKeyVaultSecret 'Microsoft.KeyVault/vaults/secrets@2023-07-01' = if (!empty(entraClientSecret)) {
  parent: keyVault
  name: 'entra-client-secret'
  properties: {
    value: entraClientSecret
  }
}

// ---------------------------------------------------------------------------
// Storage Account (used for function deployment packages)
// ---------------------------------------------------------------------------

resource storage 'Microsoft.Storage/storageAccounts@2023-01-01' = {
  name: 'st${resourceToken}'
  location: location
  tags: tags
  kind: 'StorageV2'
  sku: { name: 'Standard_LRS' }
  properties: {
    minimumTlsVersion: 'TLS1_2'
    allowBlobPublicAccess: false
    supportsHttpsTrafficOnly: true
  }
}

// Container for deployment packages (required by Flex Consumption)
resource deploymentContainer 'Microsoft.Storage/storageAccounts/blobServices/containers@2023-01-01' = {
  name: '${storage.name}/default/deploymentpackages'
  properties: {
    publicAccess: 'None'
  }
}

// ---------------------------------------------------------------------------
// Flex Consumption Hosting Plan (FC1)
// ---------------------------------------------------------------------------

resource hostingPlan 'Microsoft.Web/serverfarms@2023-12-01' = {
  name: 'asp-${resourceToken}'
  location: location
  tags: tags
  sku: {
    name: 'FC1'
    tier: 'FlexConsumption'
  }
  kind: 'functionapp'
  properties: {
    reserved: true // Linux
  }
}

// ---------------------------------------------------------------------------
// Function App
// ---------------------------------------------------------------------------

resource functionApp 'Microsoft.Web/sites@2023-12-01' = {
  name: 'func-${resourceToken}'
  location: location
  tags: union(tags, { 'azd-service-name': 'api' })
  kind: 'functionapp,linux'
  identity: {
    type: 'SystemAssigned'
  }
  properties: {
    serverFarmId: hostingPlan.id
    siteConfig: {
      appSettings: [
        // Storage access via managed identity (Flex Consumption requirement)
        { name: 'AzureWebJobsStorage__accountName', value: storage.name }
        { name: 'AzureWebJobsStorage__blobServiceUri', value: storage.properties.primaryEndpoints.blob }
        { name: 'AzureWebJobsStorage__credential', value: 'managedidentity' }
        // Application Insights
        { name: 'APPLICATIONINSIGHTS_CONNECTION_STRING', value: appInsights.properties.ConnectionString }
        // ServiceNow configuration
        { name: 'SERVICENOW_INSTANCE_URL', value: serviceNowInstanceUrl }
        { name: 'SERVICENOW_CLIENT_ID', value: serviceNowClientId }
        {
          name: 'SERVICENOW_CLIENT_SECRET'
          value: '@Microsoft.KeyVault(SecretUri=${serviceNowClientSecretKeyVaultSecret.properties.secretUriWithVersion})'
        }
        { name: 'SERVICENOW_OAUTH_TOKEN_PATH', value: '/oauth_token.do' }
        { name: 'SERVICENOW_OAUTH_GRANT_TYPE', value: 'auto' }
        { name: 'SERVICENOW_USERNAME', value: serviceNowUsername }
        {
          name: 'SERVICENOW_PASSWORD'
          // Reference Key Vault when a password was provided; otherwise empty.
          value: empty(serviceNowPassword) ? '' : '@Microsoft.KeyVault(SecretUri=${serviceNowPasswordKeyVaultSecret.properties.secretUriWithVersion})'
        }
        // Entra ID OAuth 2.0 configuration (optional)
        { name: 'ENTRA_TENANT_ID', value: entraTenantId }
        { name: 'ENTRA_CLIENT_ID', value: entraClientId }
        {
          name: 'ENTRA_CLIENT_SECRET'
          value: empty(entraClientSecret) ? '' : '@Microsoft.KeyVault(SecretUri=${entraClientSecretKeyVaultSecret.properties.secretUriWithVersion})'
        }
        { name: 'ENTRA_AUDIENCE', value: entraAudience }
        { name: 'ENTRA_TRUSTED_TENANT_IDS', value: entraTrustedTenantIds }
        { name: 'ENTRA_ALLOW_ANY_TENANT', value: entraAllowAnyTenant }
      ]
    }
    functionAppConfig: {
      deployment: {
        storage: {
          type: 'blobContainer'
          value: '${storage.properties.primaryEndpoints.blob}deploymentpackages'
          authentication: {
            type: 'SystemAssignedIdentity'
          }
        }
      }
      scaleAndConcurrency: {
        maximumInstanceCount: 40
        instanceMemoryMB: 2048
      }
      runtime: {
        name: 'node'
        version: '20'
      }
    }
  }
  dependsOn: [deploymentContainer]
}

// ---------------------------------------------------------------------------
// RBAC: grant the function app's managed identity access to the storage blob
// (required for Flex Consumption deployment package access)
// ---------------------------------------------------------------------------

// Storage Blob Data Owner — needed to read/write deployment packages
resource functionAppStorageRoleAssignment 'Microsoft.Authorization/roleAssignments@2022-04-01' = {
  name: guid(storage.id, functionApp.id, 'ba92f5b4-2d11-453d-a403-e96b0029c9fe')
  scope: storage
  properties: {
    roleDefinitionId: subscriptionResourceId(
      'Microsoft.Authorization/roleDefinitions',
      'ba92f5b4-2d11-453d-a403-e96b0029c9fe' // Storage Blob Data Owner
    )
    principalId: functionApp.identity.principalId
    principalType: 'ServicePrincipal'
  }
}

// Key Vault Secrets User - allows app to resolve Key Vault references in app settings
resource functionAppKeyVaultRoleAssignment 'Microsoft.Authorization/roleAssignments@2022-04-01' = {
  name: guid(keyVault.id, functionApp.id, '4633458b-17de-408a-b874-0445c86b69e6')
  scope: keyVault
  properties: {
    roleDefinitionId: subscriptionResourceId(
      'Microsoft.Authorization/roleDefinitions',
      '4633458b-17de-408a-b874-0445c86b69e6' // Key Vault Secrets User
    )
    principalId: functionApp.identity.principalId
    principalType: 'ServicePrincipal'
  }
}

// ---------------------------------------------------------------------------
// Outputs (consumed by azd)
// ---------------------------------------------------------------------------

output AZURE_LOCATION string = location
output AZURE_TENANT_ID string = tenant().tenantId
output FUNCTION_APP_NAME string = functionApp.name
output FUNCTION_APP_HOSTNAME string = functionApp.properties.defaultHostName
output MCP_ENDPOINT_URL string = 'https://${functionApp.properties.defaultHostName}/mcp'
output KEY_VAULT_NAME string = keyVault.name
