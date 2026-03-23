# OAuth Endpoint Verification Script
# Tests OIDC discovery and DCR endpoints

$endpoint = "https://func-sp2iostp7h6vq.azurewebsites.net"
$oidcUrl = "$endpoint/.well-known/openid-configuration"
$dcrUrl = "$endpoint/oauth/register"

Write-Host "========================================" -ForegroundColor Cyan
Write-Host "OAuth Endpoint Verification Script"
Write-Host "========================================" -ForegroundColor Cyan
Write-Host ""

# Test 1: OIDC Discovery
Write-Host "Test 1: OIDC Discovery Endpoint" -ForegroundColor Yellow
Write-Host "URL: $oidcUrl" -ForegroundColor Gray
try {
    $client = New-Object System.Net.Http.HttpClient
    $response = $client.GetAsync($oidcUrl).Result
    
    if ($response.IsSuccessStatusCode) {
        $content = $response.Content.ReadAsStringAsync().Result
        $json = ConvertFrom-Json $content
        
        Write-Host "✓ HTTP $([int]$response.StatusCode) - Success" -ForegroundColor Green
        Write-Host ""
        Write-Host "Response Details:" -ForegroundColor White
        Write-Host "  issuer: $($json.issuer)"
        Write-Host "  authorization_endpoint: $($json.authorization_endpoint)"
        Write-Host "  token_endpoint: $($json.token_endpoint)"
        Write-Host "  registration_endpoint: $($json.registration_endpoint)"
        Write-Host "  scopes_supported:"
        foreach ($scope in $json.scopes_supported) {
            Write-Host "    - $scope"
        }
        Write-Host "  code_challenge_methods_supported: $($json.code_challenge_methods_supported -join ', ')"
        Write-Host "  grant_types_supported: $($json.grant_types_supported -join ', ')"
    } else {
        Write-Host "✗ HTTP $([int]$response.StatusCode) - Failed" -ForegroundColor Red
        Write-Host "Content: $($response.Content.ReadAsStringAsync().Result)"
    }
}
catch {
    Write-Host "✗ Error: $($_.Exception.Message)" -ForegroundColor Red
}

Write-Host ""
Write-Host "========================================" -ForegroundColor Cyan

# Test 2: DCR Endpoint
Write-Host "Test 2: DCR (Dynamic Client Registration) Endpoint" -ForegroundColor Yellow
Write-Host "URL: $dcrUrl" -ForegroundColor Gray
try {
    $client = New-Object System.Net.Http.HttpClient
    $request = New-Object System.Net.Http.HttpRequestMessage([System.Net.Http.HttpMethod]::Post, $dcrUrl)
    $request.Content = New-Object System.Net.Http.StringContent("{}", [System.Text.Encoding]::UTF8, "application/json")
    
    $response = $client.SendAsync($request).Result
    
    if ($response.IsSuccessStatusCode) {
        $content = $response.Content.ReadAsStringAsync().Result
        $json = ConvertFrom-Json $content
        
        Write-Host "✓ HTTP $([int]$response.StatusCode) - Success" -ForegroundColor Green
        Write-Host ""
        Write-Host "Response Details:" -ForegroundColor White
        Write-Host "  client_id: $($json.client_id)"
        Write-Host "  client_secret: $($json.client_secret.Substring(0, 10))..." -ForegroundColor DarkGray
        Write-Host "  grant_types: $($json.grant_types -join ', ')"
        Write-Host "  response_types: $($json.response_types -join ', ')"
        Write-Host "  token_endpoint_auth_method: $($json.token_endpoint_auth_method)"
        Write-Host "  scope: $($json.scope)"
        Write-Host "  client_id_issued_at: $($json.client_id_issued_at)"
        Write-Host "  client_secret_expires_at: $($json.client_secret_expires_at)"
    } else {
        Write-Host "✗ HTTP $([int]$response.StatusCode) - Failed" -ForegroundColor Red
        Write-Host "Content: $($response.Content.ReadAsStringAsync().Result)"
    }
}
catch {
    Write-Host "✗ Error: $($_.Exception.Message)" -ForegroundColor Red
}

Write-Host ""
Write-Host "========================================" -ForegroundColor Cyan
Write-Host ""

# Test 3: Configuration Check
Write-Host "Test 3: Azure Function App Configuration" -ForegroundColor Yellow
try {
    $settings = (az functionapp config appsettings list -g "rg-dev" -n "func-sp2iostp7h6vq" | ConvertFrom-Json)
    
    Write-Host "✓ Retrieved app settings" -ForegroundColor Green
    Write-Host ""
    Write-Host "Entra Configuration:" -ForegroundColor White
    $entraSettings = $settings | Where-Object { $_.name -like "ENTRA*" }
    foreach ($setting in $entraSettings) {
        if ($setting.name -eq "ENTRA_CLIENT_SECRET") {
            Write-Host "  $($setting.name): $(if ($setting.value) { '*** SET ***' } else { 'NOT SET' })" -ForegroundColor $(if ($setting.value) { 'Green' } else { 'Red' })
        } else {
            Write-Host "  $($setting.name): $($setting.value)" -ForegroundColor $(if ($setting.value) { 'Green' } else { 'Red' })
        }
    }
    
    Write-Host ""
    Write-Host "ServiceNow Configuration:" -ForegroundColor White
    $snowSettings = $settings | Where-Object { $_.name -like "SERVICENOW*" }
    foreach ($setting in $snowSettings) {
        if ($setting.name -like "*SECRET" -or $setting.name -like "*PASSWORD") {
            Write-Host "  $($setting.name): $(if ($setting.value) { '*** SET ***' } else { 'NOT SET' })" -ForegroundColor $(if ($setting.value) { 'Green' } else { 'Red' })
        } else {
            Write-Host "  $($setting.name): $($setting.value)" -ForegroundColor $(if ($setting.value) { 'Green' } else { 'Red' })
        }
    }
}
catch {
    Write-Host "✗ Error: $($_.Exception.Message)" -ForegroundColor Red
}

Write-Host ""
Write-Host "========================================" -ForegroundColor Cyan
Write-Host "Verification Complete" -ForegroundColor Cyan
Write-Host "========================================" -ForegroundColor Cyan
