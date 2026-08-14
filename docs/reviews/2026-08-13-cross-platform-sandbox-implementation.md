# Cross-platform sandbox implementation

Status: fail-closed implementation complete for bounded delivery; promotion is blocked by real-host native probe evidence.

## Delivered

- Portable policy contract for roots, denied metadata, network mode, env allowlist,
  PTY intent, limits, output cap, and expiring grants.
- Stable J1 probe catalog and runner with explicit `pass`, `fail`, and `unavailable`
  states. Unsupported backends are never reported as protected.
- Electron main-window hardening: context isolation, renderer sandboxing, web security,
  navigation restriction, denied window opens, and HTTP(S)-only external URLs.
- Fresh per-session daemon sockets in a private directory; resident or pre-existing
  listeners are not adopted silently. Daemon lifetime is owned by the desktop process.
- `AccessMode` is persisted in main-process state and is the source of truth for
  daemon launch. Full access is explicitly unsandboxed; protected modes preflight,
  stop and rebind daemons atomically, and roll back on failure. Custom path rules
  are validated, hashed into the policy identity, and cause a rebind when changed.
- `@anthropic-ai/sandbox-runtime` launch adapter with filtered environment,
  project-scoped filesystem roots, deny-by-default network, and fail-closed dependency
  preflight plus native allow/deny fixtures through the runtime on supported hosts.
  Packaging unpacks the runtime CLI and generates an integrity manifest for the
  dynamically imported Prime Agent modules during build. The adapter refuses to
  claim protection until the behavioral fixture passes.
- Honest enforcement state in agent metadata and UI. The interactive PTY is
  available only in Full access and is explicitly unsandboxed; protected modes
  reject and close terminal sessions.
- Installer redirects are HTTPS and host-pinned; installer execution requires a
  configured SHA-256 checksum. Checkpoints and permission storage are portable.
- AccessPicker is authoritative for the persisted access mode; the UI reports
  `Unavailable` for failed protected starts and `Ready · Unsandboxed` for Full access.
- Three-OS J1 workflow added at `.github/workflows/sandbox-probes.yml`.

## Verification

- `npm install` completed; npm reports three high-severity dependency advisories that
  remain a release-supply-chain follow-up.
- `npm run typecheck` passed.
- `npm run build` passed.
- `npm run sandbox:selfcheck` passed.
- `npm run sandbox:probes` completed on Ubuntu/WSL2 with `pass=16`, `fail=0`, `unavailable=7` across 23 catalog cases.
  Native adapters cover filesystem boundaries, denied metadata, symlink escapes,
  child/grandchild processes, environment filtering, and DNS/direct egress. The
  seven unavailable cases are the two PTY cases, two timeout/output cases, and three
  daemon-attach cases; PTY is intentionally not claimed as contained by the
  current runtime wrapper, while daemon attach requires the Electron broker
  integration harness. The command still exits non-zero unless
  `PRIME_DESKTOP_ALLOW_UNAVAILABLE_PROBES=1` is explicitly set.
- `git diff --check` passed.
- Independent review confirmed the policy, transition, integrity, permission, and
  Windows-gating fixes. The latest independent review rejected shipment; no reviewer
  may promote the native sandbox while required cases remain unavailable.

## Open promotion gates

- Real macOS Seatbelt and Linux Bubblewrap/seccomp expected-allow/deny catalog
  adapters; the runtime fixture is present but does not replace the full J1 matrix.
- Linux network isolation is proven on the current WSL2 host; WSL1 remains
  unsupported for protected mode.
- Native Windows alpha setup and behavioral probes.
- PTY-in-boundary decision; current PTY is visibly unsandboxed.
- Cryptographic signing of the generated Prime Agent integrity manifest and clean-machine
  verification remain promotion work; protected sessions fail closed if the generated
  manifest is absent or mismatched.
- Classification and broker routing for gist export, skill installation, harness updates,
  and all remaining child-process paths.
- Effective-policy detail, denial ledger, and one-shot grant UX remain deferred until
  an authoritative backend exists; the current UI exposes only the honest enforcement
  state and unsandboxed PTY label.
- Clean-machine packaging, signed helper, entitlement, and escape-suite evidence.
- Electron download mirror provenance and checksum policy for the configured third-party
  mirror.

No Tauri/Rust work is included in this implementation.
