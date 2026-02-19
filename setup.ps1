# EdgeUtilities Development Environment Setup
# This script installs all prerequisites needed to build the EdgeUtilities Tauri app.

#Requires -Version 5.1
Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

function Write-Step($message) {
    Write-Host "`n>> $message" -ForegroundColor Cyan
}

function Test-Command($name) {
    return [bool](Get-Command $name -ErrorAction SilentlyContinue)
}

# --- 1. Install Rust via winget ---
Write-Step "Checking for Rust (cargo)..."
if (Test-Command "cargo") {
    Write-Host "Rust is already installed: $(cargo --version)"
} else {
    Write-Step "Installing Rust via winget..."
    winget install Rustlang.Rustup --accept-package-agreements --accept-source-agreements
    # Refresh PATH so cargo is available in this session
    $env:Path = [System.Environment]::GetEnvironmentVariable("Path", "Machine") + ";" +
                [System.Environment]::GetEnvironmentVariable("Path", "User")
    if (-not (Test-Command "cargo")) {
        Write-Error "Rust installation failed. Please install manually from https://rustup.rs"
    }
    Write-Host "Rust installed: $(cargo --version)"
}

# --- 2. Install VS 2022 Build Tools with C++ workload ---
Write-Step "Checking for MSVC link.exe..."
$vcvarsall = Get-ChildItem "C:\Program Files*\Microsoft Visual Studio\2022\*\VC\Auxiliary\Build\vcvarsall.bat" -ErrorAction SilentlyContinue |
             Select-Object -First 1

if ($vcvarsall) {
    Write-Host "VS Build Tools already installed: $($vcvarsall.FullName)"
} else {
    Write-Step "Installing Visual Studio 2022 Build Tools with C++ workload via winget..."
    winget install Microsoft.VisualStudio.2022.BuildTools `
        --accept-package-agreements `
        --accept-source-agreements `
        --override "--quiet --wait --add Microsoft.VisualStudio.Workload.VCTools --includeRecommended"

    $vcvarsall = Get-ChildItem "C:\Program Files*\Microsoft Visual Studio\2022\*\VC\Auxiliary\Build\vcvarsall.bat" -ErrorAction SilentlyContinue |
                 Select-Object -First 1
    if (-not $vcvarsall) {
        Write-Error "VS Build Tools installation failed. Please install manually."
    }
    Write-Host "VS Build Tools installed: $($vcvarsall.FullName)"
}

# --- 3. Set up MSVC environment for Rust ---
Write-Step "Initializing MSVC environment (vcvarsall.bat x64)..."
cmd /c "`"$($vcvarsall.FullName)`" x64 >nul 2>&1 && set" | ForEach-Object {
    if ($_ -match '^([^=]+)=(.*)$') {
        [System.Environment]::SetEnvironmentVariable($matches[1], $matches[2], 'Process')
    }
}

if (-not (Test-Command "link")) {
    Write-Error "Failed to set up MSVC environment. link.exe not found on PATH."
}
Write-Host "MSVC environment ready: $(where.exe link | Select-Object -First 1)"

# --- 4. Install Node.js dependencies ---
Write-Step "Checking for Node.js..."
if (-not (Test-Command "node")) {
    Write-Error "Node.js is not installed. Please install it from https://nodejs.org or via winget: winget install OpenJS.NodeJS.LTS"
}
Write-Host "Node.js: $(node --version)"

Write-Step "Installing npm dependencies..."
Push-Location $PSScriptRoot
npm install
Pop-Location

# --- Done ---
Write-Host "`n========================================" -ForegroundColor Green
Write-Host " Setup complete!" -ForegroundColor Green
Write-Host " To build: npm run tauri build" -ForegroundColor Green
Write-Host " To dev:   npm run tauri dev" -ForegroundColor Green
Write-Host "========================================" -ForegroundColor Green
