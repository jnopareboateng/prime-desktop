# Sol final review — cross-platform sandbox job spec

Status: cleared for bounded implementation work; no code started.  
Reviewer: Sol, medium reasoning.  
Authority checked: research review, job spec, and completed Claude Opus clearance.

## Verdict

**CLEAR TO BEGIN, bounded to J0/J1/J3 spike work.** The spec is coherent after
the required corrections. It does not claim security or production readiness,
does not expand into a Tauri/Rust migration, and does not require a large test
repository.

## Review result

- The resident `prime-agent` daemon is now named as the enforcement unit, with
  one policy scope per daemon and no protected attach without attestation.
- Main-process dynamic loading from the installed agent tree is explicitly an
  in-main supply-chain path requiring integrity verification.
- Daemon adoption/lifetime, socket client environment, installer redirects,
  external URL schemes, grant expiry, and the J1-before-J3 evidence dependency
  are explicit.
- Research/spec network vocabulary is consistent: `none`, `proxy-only`,
  `restricted`.
- `sandbox-runtime` remains a macOS/Linux spike and Windows-alpha input, not a
  guarantee. PTY protection remains a measured go/no-go.

## Remaining gates

No backend probe has passed on a real host. Windows, PTY containment, daemon
attestation, module integrity, installer/update provenance, Electron hardening,
signing, and clean-machine promotion remain implementation gates. Until then,
the UI must retain the honest unsandboxed copy.

## Handoff

Start with the smallest useful vertical slice: J0 portability, J1 targeted
capability/escape probes, and the macOS/Linux `sandbox-runtime` adapter spike.
Return for human product testing after that slice exposes effective policy,
denials, and honest enforcement state. Do not begin the Tauri/Rust pivot here.
