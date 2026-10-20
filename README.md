# Prime Desktop

Prime Desktop is a cross-platform Electron client for [Prime Agent](https://github.com/PrimeIntellect-ai/prime-agent). It provides a focused chat workspace with streaming responses, tool activity, subagent inspection, session resume, model selection, projects, and review surfaces.

## Requirements

- macOS, Linux, or Windows
- Node.js 20 or newer
- A working `prime-agent` installation available on `PATH`

On Windows, the app also discovers npm-global installs such as
`C:\\nvm4w\\nodejs\\prime-agent.cmd` and the Install Prime Agent action uses
`npm install --global prime-agent` when needed. WSL2 project folders can be
opened through their `\\\\wsl.localhost\\<distro>\\...` path and are executed by
the Windows Prime Agent runtime.

## Development

```bash
npm install
npm run dev
```

Useful checks:

```bash
npm run typecheck
npm run build
```

The app starts Prime Agent in RPC mode for each opened project. Session data remains managed by Prime Agent in its normal local session store.

## Packaging

```bash
npm run package
```

The packaged application requires the same Prime Agent runtime and platform permissions as the development app.

Sandbox status is deliberately reported honestly. The sandbox adapter is
opt-in and fails closed until the host backend and behavioral probes pass. The
Windows backend requires the sandbox-runtime one-time machine setup; WSL1 is
not supported for protected mode, and the Windows app does not silently bridge
to a Linux Prime Agent daemon inside WSL.

For a Windows installer, run this on Windows after installing dependencies with `npm ci`:

```bash
npm run package:win
```

This produces `release/Prime-Desktop-Setup-<version>.exe` using the NSIS installer target.

## Tauri host (in progress)

`src-tauri/` is a Tauri v2 host on a Rust core (`src-tauri/crates/core`, no Tauri in it) that drives the Rust Prime Agent through its daemon protocol, and `sandbox/` is the Rust sandbox for the agent's code (policy, helper, kernel wrapper and probes). The Electron app is unchanged and still what ships.

- The product name and ids come from `src/shared/product.json`; a private build replaces that one file and passes its own Tauri settings with `TAURI_CONFIG`. Nothing else names a product.
- Signing is left to the builder: `certificateThumbprint` is unset, and `scripts/tauri-agent.mjs --sign "<command>"` signs the bundled agent.
- Checks that run today: `cargo +stable clippy --workspace --all-targets -- -D warnings` and `cargo +stable test --workspace` in `src-tauri` and in `sandbox`. The renderer bridge (`window.prime` over Tauri) is not here yet: it lands with the UI port, because this repo's preload is an older contract than the one the host answers.

## License

No license has been selected yet. Add one before distributing this project for reuse.
