// Packaging config. Product identity comes from src/shared/product.json, so a private build can swap that one file.
import { readFileSync } from 'node:fs'

const product = JSON.parse(readFileSync(new URL('./src/shared/product.json', import.meta.url), 'utf8'))

export default {
  appId: product.appId,
  productName: product.name,
  directories: { output: 'release', buildResources: 'build' },
  files: ['out/**', 'package.json'],
  asarUnpack: ['node_modules/@anthropic-ai/sandbox-runtime/**', 'node_modules/prime-agent/**'],
  mac: {
    target: ['dmg', 'zip'],
    category: 'public.app-category.developer-tools',
    hardenedRuntime: true,
    gatekeeperAssess: false,
    entitlements: 'build/entitlements.mac.plist',
    entitlementsInherit: 'build/entitlements.mac.plist'
  },
  dmg: {
    title: product.name,
    contents: [
      { x: 130, y: 220 },
      { x: 410, y: 220, type: 'link', path: '/Applications' }
    ]
  },
  // node-pty ships platform prebuilds; avoid requiring optional Spectre libraries.
  npmRebuild: false,
  win: {
    target: ['nsis'],
    artifactName: `${product.artifactName}-Setup-\${version}.\${ext}`
  },
  nsis: {
    oneClick: false,
    perMachine: false,
    allowToChangeInstallationDirectory: true
  },
  electronDownload: { mirror: 'https://npmmirror.com/mirrors/electron/' }
}
