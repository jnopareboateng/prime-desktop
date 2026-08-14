import { createHash } from 'node:crypto'
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const projectRoot = dirname(dirname(fileURLToPath(import.meta.url)))
const agentRoot = join(projectRoot, 'node_modules', 'prime-agent')
const files = [
  'dist/modes/daemon/daemon-client.js',
  'dist/modes/agent-connection/daemon-agent-connection.js'
]

const hashes = {}
for (const relativePath of files) {
  const absolutePath = join(agentRoot, relativePath)
  if (!existsSync(absolutePath)) throw new Error(`Prime Agent integrity input is missing: ${relativePath}`)
  hashes[relativePath] = createHash('sha256').update(readFileSync(absolutePath)).digest('hex')
}

writeFileSync(join(agentRoot, 'prime-desktop-integrity.json'), JSON.stringify({ version: 1, files: hashes }, null, 2) + '\n')
