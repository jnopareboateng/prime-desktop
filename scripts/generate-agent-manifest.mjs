import { createHash } from 'node:crypto'
import { existsSync, readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const projectRoot = dirname(dirname(fileURLToPath(import.meta.url)))
const agentRoot = join(projectRoot, 'node_modules', 'prime-agent')
function integrityFiles(directory, relative = '') {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const entryRelative = join(relative, entry.name)
    const absolute = join(directory, entry.name)
    if (entry.isDirectory()) return integrityFiles(absolute, entryRelative)
    return /\.(?:cjs|mjs|js)$/.test(entry.name) ? [entryRelative.replaceAll('\\\\', '/')] : []
  })
}

const files = integrityFiles(join(agentRoot, 'dist'), 'dist').sort()
if (!files.includes('dist/modes/daemon/daemon-client.js') || !files.includes('dist/modes/agent-connection/daemon-agent-connection.js')) {
  throw new Error('Prime Agent integrity manifest inputs are missing the resident transport modules.')
}

const hashes = {}
for (const relativePath of files) {
  const absolutePath = join(agentRoot, relativePath)
  if (!existsSync(absolutePath)) throw new Error(`Prime Agent integrity input is missing: ${relativePath}`)
  hashes[relativePath] = createHash('sha256').update(readFileSync(absolutePath)).digest('hex')
}

writeFileSync(join(agentRoot, 'prime-desktop-integrity.json'), JSON.stringify({ version: 1, files: hashes }, null, 2) + '\n')
