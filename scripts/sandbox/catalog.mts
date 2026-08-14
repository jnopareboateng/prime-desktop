import type { ProbeCase } from './types.mts'

// Expected allow/deny cases for the sandbox security probes required by the
// job spec (docs/specs/2026-08-13-cross-platform-sandbox-job-spec.md,
// "Security probes"). Each category needs at least one denied case and, for
// most, an allowed control case so a backend that fails open is caught.
export const PROBE_CATALOG: ProbeCase[] = [
  // outside-root read/write
  {
    id: 'fs.outside-root.read.denied',
    category: 'outside-root-read',
    expect: 'deny',
    description: 'Reading a path outside every declared root is denied.',
  },
  {
    id: 'fs.workspace.read.allowed',
    category: 'outside-root-read',
    expect: 'allow',
    description: 'Reading a path inside a declared workspace root is allowed.',
  },
  {
    id: 'fs.outside-root.write.denied',
    category: 'outside-root-write',
    expect: 'deny',
    description: 'Writing a path outside every declared root is denied.',
  },
  {
    id: 'fs.workspace.write.allowed',
    category: 'outside-root-write',
    expect: 'allow',
    description: 'Writing a path inside a declared workspace root is allowed.',
  },

  // denied carve-outs inside an otherwise-allowed root
  {
    id: 'fs.carve-out.git-read.denied',
    category: 'denied-carve-out',
    expect: 'deny',
    description: 'Reading .git metadata inside the workspace root is denied.',
  },
  {
    id: 'fs.carve-out.git-write.denied',
    category: 'denied-carve-out',
    expect: 'deny',
    description: 'Writing .git metadata inside the workspace root is denied.',
  },

  // symlink escape
  {
    id: 'fs.symlink.read-escape.denied',
    category: 'symlink-escape',
    expect: 'deny',
    description: 'Reading through a symlink that resolves outside the root is denied.',
  },
  {
    id: 'fs.symlink.write-escape.denied',
    category: 'symlink-escape',
    expect: 'deny',
    description: 'Writing through a symlink that resolves outside the root is denied.',
  },

  // child/grandchild process inheritance
  {
    id: 'proc.child.denied-binary.denied',
    category: 'child-process',
    expect: 'deny',
    description: 'Spawning a binary outside policy allowance is denied.',
  },
  {
    id: 'proc.grandchild.escape.denied',
    category: 'child-process',
    expect: 'deny',
    description: 'A grandchild process cannot escape the parent policy scope.',
  },
  {
    id: 'proc.shell-metacharacters.denied',
    category: 'child-process',
    expect: 'deny',
    description: 'Shell metacharacters in argv do not expand into an unpoliced command.',
  },

  // environment scrubbing
  {
    id: 'env.disallowed-var.scrubbed',
    category: 'env-scrub',
    expect: 'deny',
    description: 'A variable outside the environment allowlist is not visible to the child.',
  },
  {
    id: 'env.allowlisted-var.passthrough',
    category: 'env-scrub',
    expect: 'allow',
    description: 'A variable on the environment allowlist is visible to the child.',
  },

  // network
  {
    id: 'net.dns.blocked',
    category: 'network',
    expect: 'deny',
    description: 'DNS resolution is blocked when network mode is "none".',
  },
  {
    id: 'net.egress.blocked',
    category: 'network',
    expect: 'deny',
    description: 'Outbound connection is blocked when network mode is "none".',
  },
  {
    id: 'net.proxy-only.direct-egress.denied',
    category: 'network',
    expect: 'deny',
    description: 'Direct egress is denied when network mode is "proxy-only".',
  },

  // timeout / output caps
  {
    id: 'limits.timeout.enforced',
    category: 'timeout-output',
    expect: 'deny',
    description: 'A process exceeding the configured timeout is terminated.',
  },
  {
    id: 'limits.output-cap.enforced',
    category: 'timeout-output',
    expect: 'deny',
    description: 'Output beyond the configured cap is truncated, not delivered whole.',
  },

  // PTY behavior
  {
    id: 'pty.outside-root-write.denied',
    category: 'pty',
    expect: 'deny',
    description: 'A command run inside an allocated PTY cannot write outside declared roots.',
  },
  {
    id: 'pty.workspace-write.allowed',
    category: 'pty',
    expect: 'allow',
    description: 'A command run inside an allocated PTY can write inside declared roots.',
  },

  // daemon attach
  {
    id: 'daemon.attach.unverified-socket.denied',
    category: 'daemon-attach',
    expect: 'deny',
    description: 'A protected session refuses to attach to an unverified daemon.',
  },
  {
    id: 'daemon.attach.known-socket.allowed',
    category: 'daemon-attach',
    expect: 'allow',
    description: 'Adoption of a pre-existing verified daemon on the known socket is allowed.',
  },
  {
    id: 'daemon.reattach-after-quit.allowed',
    category: 'daemon-attach',
    expect: 'allow',
    description: 'Re-adoption of the daemon after app quit succeeds for a verified socket.',
  },
]
