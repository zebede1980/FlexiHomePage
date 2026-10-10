// `docker exec -it flexihome flexihome <command>`: the jobs that need access to the machine.

import { Auth } from './auth.js';
import { config } from './config.js';
import { openDb } from './db.js';
import { Machines } from './machines.js';

const [command, arg] = process.argv.slice(2);
const db = openDb(config.dataDir);
const auth = new Auth(db);
const machines = new Machines(db);

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
  case 'machines': {
    const list = machines.list();
    if (!list.length) console.log('No other machines report in.');
    for (const m of list) {
      console.log(`${String(m.id).padStart(3)}  ${m.name.padEnd(30)} last heard from ${m.seenAt ? new Date(m.seenAt).toISOString() : 'never'}`);
    }
    break;
  }
  case 'add-machine': {
    const made = machines.create(arg ?? '');
    console.log(`Added "${made.name}" as machine ${made.id}. Its key, shown this once:\n\n  ${made.key}\n`);
    console.log('Give it to the agent on that machine (see the README, "Other machines"). The Server tab appears once the page is reloaded.');
    break;
  }
  case 'remove-machine': {
    // The running site holds this machine's readings in memory too; they go when it next restarts.
    machines.remove(Number(arg));
    console.log(`Removed machine ${arg} and what was recorded about it. Its key no longer works.`);
    break;
  }
  default:
    console.log(
      'Commands:\n  reset-password       print a one-time link for choosing a new password\n  bridges              list linked browsers\n  unlink <id>          revoke a linked browser\n  machines             list the other machines that report in\n  add-machine <name>   make a key for another machine\'s agent\n  remove-machine <id>  forget a machine and revoke its key',
    );
}
db.close();
