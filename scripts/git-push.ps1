# 一键提交并推送（功能完成后手动执行）
#
# 用法：
#   .\scripts\git-push.ps1 -Message "feat: 本次改动说明"
#   .\scripts\git-push.ps1 -Message "release: v1.1.0" -Tag v1.1.0
#   .\scripts\git-push.ps1 -Message "chore: 初始化" -RemoteUrl "https://github.com/<账号>/Linda_ERP.git"
#
# 说明：
# - 不会自动实时提交，只在手动执行时提交一次
# - -Tag 会为本次提交打版本标签并推送标签
# - -RemoteUrl 用于首次关联远程仓库（或更换远程地址）

param(
  [Parameter(Mandatory = $true)]
  [string]$Message,

  [string]$Tag = "",

  [string]$RemoteUrl = ""
)

$ErrorActionPreference = "Stop"
$repoRoot = Split-Path -Parent $PSScriptRoot
Set-Location $repoRoot

if (-not (Test-Path (Join-Path $repoRoot ".git"))) {
  throw "当前目录不是 Git 仓库，请先在项目根目录执行 git init"
}

if ($RemoteUrl -ne "") {
  $existing = git remote 2>$null
  if ($existing -contains "origin") {
    git remote set-url origin $RemoteUrl
  } else {
    git remote add origin $RemoteUrl
  }
  Write-Host "远程仓库已设置为：$RemoteUrl"
}

$remotes = git remote 2>$null
if (-not $remotes) {
  throw "尚未配置远程仓库。请先在 GitHub 创建私有仓库 Linda_ERP，然后执行：`n  .\scripts\git-push.ps1 -Message '<说明>' -RemoteUrl 'https://github.com/<账号>/Linda_ERP.git'"
}

git add -A

$status = git status --porcelain
if (-not $status) {
  Write-Host "没有需要提交的改动，跳过提交。"
  exit 0
}

git commit -m $Message
Write-Host "已提交：$Message"

if ($Tag -ne "") {
  git tag $Tag
  Write-Host "已打标签：$Tag"
}

$branch = (git rev-parse --abbrev-ref HEAD).Trim()
Write-Host "推送分支：$branch"
git push -u origin $branch

if ($Tag -ne "") {
  git push origin $Tag
  Write-Host "标签 $Tag 已推送"
}

Write-Host "完成 ✅"
