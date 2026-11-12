# Allows the Fire TV stick to reach the Stremio streaming server on this PC.
# Run in an elevated PowerShell (Run as administrator).
# Opens TCP 11470 (HTTP streaming server) for the Private network profile only.
# Make sure your home Wi-Fi/Ethernet network is set to "Private" in Windows.

$ruleName = "Stremio streaming server (LAN, TCP 11470)"
if (Get-NetFirewallRule -DisplayName $ruleName -ErrorAction SilentlyContinue) {
    Write-Host "Rule already exists: $ruleName"
} else {
    New-NetFirewallRule -DisplayName $ruleName -Direction Inbound -Protocol TCP -LocalPort 11470 -Action Allow -Profile Private | Out-Null
    Write-Host "Created firewall rule: $ruleName"
}

Write-Host ""
Write-Host "This PC's LAN IPv4 addresses (enter one in the Vega Stremio app > Settings > Streaming server):"
Get-NetIPAddress -AddressFamily IPv4 |
    Where-Object { $_.IPAddress -notlike "127.*" -and $_.IPAddress -notlike "169.254.*" -and $_.InterfaceAlias -notlike "*WSL*" -and $_.InterfaceAlias -notlike "vEthernet*" } |
    Select-Object InterfaceAlias, IPAddress | Format-Table -AutoSize

Write-Host "Test from this PC: http://127.0.0.1:11470/settings should return JSON while Stremio/Stremio Service is running."
