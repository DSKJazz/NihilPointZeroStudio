[CmdletBinding()]
param([switch]$CleanGenerated)

$ErrorActionPreference = "Stop"
$RepoPath = (Resolve-Path (Join-Path -Path $PSScriptRoot -ChildPath "..")).Path
$ExpectedPackageName = "finscript-studio"

function Invoke-Step([string]$Name, [scriptblock]$Action) {
    Write-Host "`n== $Name ==" -ForegroundColor Cyan
    & $Action
    if ($LASTEXITCODE -ne 0) { throw "$Name failed with exit code $LASTEXITCODE" }
}

$packagePath = Join-Path $RepoPath "package.json"
if (-not (Test-Path -LiteralPath $packagePath -PathType Leaf)) { throw "Refusing to run: package.json not found." }
$package = Get-Content -LiteralPath $packagePath -Raw | ConvertFrom-Json
if ($package.name -ne $ExpectedPackageName) { throw "Refusing to run: unexpected package name '$($package.name)'." }
$gitRoot = (git -C $RepoPath rev-parse --show-toplevel 2>$null).Trim()
if ($LASTEXITCODE -ne 0 -or [string]::IsNullOrWhiteSpace($gitRoot) -or [IO.Path]::GetFullPath($gitRoot).TrimEnd('\') -ne $RepoPath.TrimEnd('\')) {
    throw "Refusing to run: script is not inside the expected Git repository root."
}

Set-Location -LiteralPath $RepoPath
if ($CleanGenerated) {
    @("node_modules", "out", "dist", "build", "coverage", ".vite") | ForEach-Object {
        $target = Join-Path $RepoPath $_
        if (Test-Path -LiteralPath $target) { Remove-Item -LiteralPath $target -Recurse -Force }
    }
}

Invoke-Step "Install locked dependencies" { npm ci --no-fund --no-audit }
Invoke-Step "Production build" { npm run build }
Invoke-Step "Test suite" { npm test }

Write-Host "`n== Audit summary ==" -ForegroundColor Cyan
npm audit --omit=optional
if ($LASTEXITCODE -ne 0) {
    Write-Host "Audit reports advisories; recovery validation still passed build and tests." -ForegroundColor Yellow
}

Write-Host "`nRecovery validation complete for $RepoPath" -ForegroundColor Green
