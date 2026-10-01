// Generates a manifest "key" so the unpacked extension has the same ID on every
// machine (otherwise Chromium derives the ID from the folder path). A stable ID
// keeps chrome-extension:// URLs, e.g. a synced homepage setting, working
// everywhere. The private half is not needed for unpacked installs.
// Usage: node scripts/make-key.mjs

import { createHash, generateKeyPairSync } from 'node:crypto';

const { publicKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
const der = publicKey.export({ type: 'spki', format: 'der' });
const id = [...createHash('sha256').update(der).digest('hex').slice(0, 32)]
  .map((h) => String.fromCharCode(97 + parseInt(h, 16)))
  .join('');

console.log(JSON.stringify({ key: der.toString('base64'), id }, null, 2));
