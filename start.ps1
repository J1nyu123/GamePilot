param([switch]$Production, [switch]$CaptureOnly)
$ErrorActionPreference = 'Stop'
Push-Location $PSScriptRoot
$previousKey = $env:GAMEPILOT_API_KEY
try {
    # Credential stays in this process and child environment; never write it to disk.
    if (-not $CaptureOnly -and [string]::IsNullOrWhiteSpace($env:ARK_API_KEY) -and [string]::IsNullOrWhiteSpace($env:GAMEPILOT_API_KEY)) {
        $keyInput = Read-Host 'API Key (hidden; used for this session only)' -AsSecureString
        $env:GAMEPILOT_API_KEY = [System.Net.NetworkCredential]::new('', $keyInput).Password
    }
    if ($Production) { npm start } else { npm run dev }
} finally {
    if ($null -eq $previousKey) { Remove-Item Env:GAMEPILOT_API_KEY -ErrorAction SilentlyContinue }
    else { $env:GAMEPILOT_API_KEY = $previousKey }
    Pop-Location
}
