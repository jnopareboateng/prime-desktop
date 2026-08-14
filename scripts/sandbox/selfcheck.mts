import assert from 'node:assert/strict'
import { clearBackends, currentPlatform, registerBackend, runProbe } from './runner.mts'
import type { ProbeCase } from './types.mts'

const fixture: ProbeCase = {
  id: 'selfcheck.fixture',
  category: 'outside-root-read',
  expect: 'deny',
  description: 'selfcheck fixture case',
}

async function main() {
  clearBackends()

  const noBackend = await runProbe(fixture)
  assert.equal(noBackend.status, 'unavailable', 'no registered backend must report unavailable')

  registerBackend('outside-root-read', async () => ({ outcome: 'deny' }))
  const matched = await runProbe(fixture)
  assert.equal(matched.status, 'pass', 'observation matching expectation must pass')

  registerBackend('outside-root-read', async () => ({ outcome: 'allow' }))
  const mismatched = await runProbe(fixture)
  assert.equal(mismatched.status, 'fail', 'observation contradicting expectation must fail')

  registerBackend('outside-root-read', async () => {
    throw new Error('boom')
  })
  const threw = await runProbe(fixture)
  assert.equal(threw.status, 'fail', 'a throwing backend must fail, not unavailable')
  assert.equal(threw.detail, 'boom')

  registerBackend('outside-root-read', async () => ({ outcome: 'deny' }))
  const otherPlatform = currentPlatform() === 'darwin' ? 'linux' : 'darwin'
  const wrongPlatform = await runProbe({ ...fixture, platforms: [otherPlatform] })
  assert.equal(wrongPlatform.status, 'unavailable', 'a case scoped to another platform must report unavailable')

  clearBackends()
  console.log('scripts/sandbox selfcheck: all assertions passed')
}

main().catch((err) => {
  console.error('scripts/sandbox selfcheck FAILED:', err)
  process.exitCode = 1
})
