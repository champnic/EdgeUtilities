---
name: build
description: "Build the EdgeUtilities Tauri app. Use when asked to 'build', 'compile', 'make', or 'create installer' for EdgeUtilities."
---

# Build EdgeUtilities

Build the EdgeUtilities Tauri desktop app, producing an executable and installers.

## Prerequisites

Before building, the following must be available:
- **Node.js** and **npm**
- **Rust** (`cargo`)
- **MSVC linker** (`link.exe`) via VS 2022 Build Tools

If any of these are missing or the build fails due to missing dependencies, invoke the **setup** skill first by running `.\setup.ps1` from the EdgeUtilities root.

## Steps

1. Ensure you are in the EdgeUtilities directory:

   ```powershell
   cd D:\EdgeUtilities
   ```

2. If `node_modules` does not exist, install npm dependencies:

   ```powershell
   npm install
   ```

3. If `link.exe` is not on PATH (check with `where.exe link`), initialize the MSVC environment:

   ```powershell
   cmd /c '"C:\Program Files (x86)\Microsoft Visual Studio\2022\BuildTools\VC\Auxiliary\Build\vcvarsall.bat" x64 >nul 2>&1 && set' | ForEach-Object { if ($_ -match '^([^=]+)=(.*)$') { [System.Environment]::SetEnvironmentVariable($matches[1], $matches[2], 'Process') } }
   ```

4. Build the app:

   ```powershell
   npm run tauri build
   ```

## Output

A successful build produces:
- **Executable:** `src-tauri\target\release\edge-utilities.exe`
- **MSI installer:** `src-tauri\target\release\bundle\msi\Edge Utilities_<version>_x64_en-US.msi`
- **NSIS installer:** `src-tauri\target\release\bundle\nsis\Edge Utilities_<version>_x64-setup.exe`

## Dev Mode

For iterative development with hot-reload, use dev mode instead:

```powershell
npm run tauri dev
```

## Troubleshooting

| Error | Fix |
|-------|-----|
| `cargo` not found | Run `.\setup.ps1` or `winget install Rustlang.Rustup` |
| `link.exe` not found | Run `.\setup.ps1` or initialize vcvarsall (step 3 above) |
| `node` / `npm` not found | Install Node.js: `winget install OpenJS.NodeJS.LTS` |
| npm dependency errors | Delete `node_modules` and run `npm install` |
| Rust compile errors | Check `src-tauri/` for code issues; run `cargo check` in `src-tauri/` |
