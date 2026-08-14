# Opus review: cross-platform sandbox research

Status: approved with required changes; implementation not started.  
Reviewer: Claude Opus, read-only independent review.  
Target: `docs/reviews/2026-08-13-cross-platform-sandbox-research.md`.

## Scope and evidence

Opus checked the research claims against the linked upstream sources and read
the Prime Desktop execution, IPC, renderer, packaging, binary, and test-related
files. The review session completed successfully with no project-file changes.

## Verdict

The external reference analysis is accurate and the source set is useful. The
document was not blocked, but specs could not safely start until the following
repo-side gaps were made explicit.

## Required findings

1. **Execution inventory:** the app has more than two unsandboxed paths:
   daemon Bash, direct PTY, renderer-to-PTY stdin, binary install/discovery,
   renderer-selected cwd, and skill installation. Installer provenance must be
   treated as a phase-1 security concern; a child sandbox cannot repair a
   poisoned installer.
2. **Approval reality:** `permissions.matchPermission` has no callers and would
   fail open on a cold cache. Enforcement is absent, and UI copy must not claim
   approval behavior until main-process tests prove it.
3. **Trust UX:** `AccessPicker` is decorative state. It displays approval modes
   while `bash` and `terminalWrite` execute without consulting main policy. The
   spec must delete it or wire it to the authoritative policy broker.
4. **Portability sequencing:** the app is macOS-only today: hardcoded app paths,
   POSIX shells/sockets/PATHs, macOS launch helpers, and mac-only packaging.
   Portability baseline is Phase 0, before backend selection.
5. **PTY:** PTY isolation is a go/no-go experiment, especially when the
   Windows runtime uses a separate local account. Fallback must be explicit:
   sandboxed non-interactive execution plus a visibly unsandboxed terminal.
6. **Test substrate:** no test runner, test script, CI, or assertion-based
   escape probes exists. Add runner and CI before the conformance matrix.
7. **Environment leak:** child processes inherit the full Electron environment.
   Connect the proposed environment allowlist to the first enforcement work.

## Required research qualifications

- Claude Code's documented default is fail-open when sandbox startup fails;
  Prime's product gate should deliberately fail closed for protected modes.
- `sandbox-runtime` Windows local-account/WFP setup likely requires elevated
  installation; confirm empirically before committing to it.
- The Codex app-server README link needs confirmation because its GitHub page
  returned a load-error during review.
- Moving `main`/`master` links should be pinned to SHAs at spec time.

## Product direction

Lead with the denial ledger and remediation flow, not a generic mode picker:
what failed, which capability is missing, what exact grant would change, and
whether retry preserves the boundary. Keep one enforced policy for agent tools
and the user's terminal, or label the terminal honestly when that is impossible.

## Approval gate

Research doc: **approved with required changes**, with those changes now folded
into the bounded research document. Implementation specs may proceed, but no
security or production-readiness claim is earned until native conformance,
clean-machine, installer provenance, PTY, and signed-helper gates pass.
