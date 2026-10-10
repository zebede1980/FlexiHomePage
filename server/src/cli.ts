// `docker exec -it flexihome flexihome <command>`: the jobs that need access to the machine.

import { Auth } from './auth.js';
import { config } from './config.js';
import { openDb } from './db.js';

const [command, arg] = process.argv.slice(2);
const db = openDb(config.dataDir);
const auth = new Auth(db);

switch (command) {
  case 'reset-password': {
    const code = auth.issueSetupCode();
    console.log(`Open the site with this on the end of its address, within 24 hours, to choose a new password:\n\n  /#setup=${code}\n`);
    console.log('The current password keeps working until then. Choosing a new one signs every browser out; linked browsers stay linked.');
    break;
  }
  case 'bridges': {
    const list = auth.listTokens();
    if (!list.length) console.log('No browsers are linked.');
    for (const t of list) {
      console.log(`${String(t.id).padStart(3)}  ${t.name.padEnd(30)} last seen ${t.seenAt ? new Date(t.seenAt).toISOString() : 'never'}`);
    }
    break;
  }
  case 'unlink': {
    auth.revokeToken(Number(arg));
    console.log(`Unlinked browser ${arg}.`);
    break;
  }
  default:
    console.log('Commands:\n  reset-password   print a one-time link for choosing a new password\n  bridges          list linked browsers\n  unlink <id>      revoke a linked browser');
}
db.close();
