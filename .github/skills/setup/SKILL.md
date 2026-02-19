---
name: setup
description: "Set up the EdgeUtilities development environment. Use when asked to 'set up', 'install dependencies', 'configure environment', or when a build or launch fails due to missing tools like cargo, link.exe, node, or npm."
---

# EdgeUtilities Setup

Run the setup script to install all prerequisites needed to build and run the EdgeUtilities Tauri app.

## When to Use

Run this skill whenever:
- `cargo` or `rustc` is not found
- `link.exe` is not found (MSVC linker missing)
- `node` or `npm` is not found
- `npm run tauri build` or `npm run tauri dev` fails with dependency errors
- The user asks to set up or configure the EdgeUtilities project

## Steps

1. Run the setup script from the EdgeUtilities root:

   ```powershell
   cd D:\EdgeUtilities
   .\setup.ps1
   ```

2. The script handles:
   - **Rust/Cargo**: Installs via `winget install Rustlang.Rustup` if missing
   - **VS 2022 Build Tools**: Installs with C++ workload via winget if missing
   - **MSVC environment**: Initializes `vcvarsall.bat x64` so Rust can find `link.exe`
   - **npm dependencies**: Runs `npm install`

3. After setup completes, build with:

   ```powershell
   npm run tauri build
   ```

   Or launch in dev mode:

   ```powershell
   npm run tauri dev
   ```

## Important Notes

- The MSVC environment (`link.exe` on PATH) is only set for the current terminal session. If building in a new terminal and `link.exe` is not found, re-run `.\setup.ps1` or manually invoke vcvarsall:

  ```powershell
  cmd /c '"C:\Program Files (x86)\Microsoft Visual Studio\2022\BuildTools\VC\Auxiliary\Build\vcvarsall.bat" x64 >nul 2>&1 && set' | ForEach-Object { if ($_ -match '^([^=]+)=(.*)$') { [System.Environment]::SetEnvironmentVariable($matches[1], $matches[2], 'Process') } }
  ```

- The script requires **winget** and an **internet connection** for first-time installs.
- **Node.js** must already be installed. If missing, install via `winget install OpenJS.NodeJS.LTS`.
