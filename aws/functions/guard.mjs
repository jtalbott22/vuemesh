// Lambda, every 15 minutes: past the month's data allowance, the relay (aws/stun) is switched off,
// so nobody can run up a bill on it. Admin can switch it back on (Servers).
import { lightsail } from './lib/lightsail.mjs';
import { guard } from './lib/relay-guard.mjs';

const ls = lightsail();
export const handler = () => guard(ls);
