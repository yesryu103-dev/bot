param(
  [Parameter(Mandatory = $true)]
  [string]$HostName,

  [Parameter(Mandatory = $true)]
  [string]$User,

  [string]$RemoteDir = "/tmp/wallet-bot"
)

$ErrorActionPreference = "Stop"

$archive = Join-Path $PWD "wallet-bot-deploy.zip"
if (Test-Path $archive) {
  Remove-Item -LiteralPath $archive -Force
}

$exclude = @(
  "node_modules",
  ".git",
  "bot.out.log",
  "bot.err.log",
  "wallet-bot-deploy.zip"
)

$files = Get-ChildItem -Force | Where-Object { $exclude -notcontains $_.Name }
Compress-Archive -Path $files.FullName -DestinationPath $archive -Force

ssh "${User}@${HostName}" "sudo apt-get update && sudo apt-get install -y unzip && rm -rf '$RemoteDir' && mkdir -p '$RemoteDir'"
scp $archive "${User}@${HostName}:$RemoteDir/wallet-bot-deploy.zip"
ssh "$User@$HostName" "cd '$RemoteDir' && unzip -o wallet-bot-deploy.zip && sudo bash deploy/setup-ubuntu.sh"

Write-Host "Deployed. Check logs with:"
Write-Host "ssh $User@$HostName `"sudo journalctl -u wallet-bot -f`""
