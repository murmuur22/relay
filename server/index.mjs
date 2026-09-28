import {isAbsolute} from 'node:path';
import { createGateway } from "./gateway.mjs";
const port = Number(process.env.PORT || 4180),
  keepsakesPort = Number(process.env.KEEPSAKES_PORT || 4181);
if (
  !Number.isInteger(port) ||
  port < 1 ||
  port > 65535 ||
  !Number.isInteger(keepsakesPort) ||
  keepsakesPort < 1 ||
  keepsakesPort > 65535
)
  throw Error("Invalid configured port");
const profile = process.env.RELAY_PROFILE ?? 'development';
const hostname = process.env.RELAY_HOSTNAME ?? '127.0.0.1';
const runtime = process.env.RELAY_STATE_DIR;
if(runtime !== undefined && !isAbsolute(runtime)) throw Error('RELAY_STATE_DIR must be an absolute path');
const networkMode = process.env.RELAY_NETWORK_MODE ?? 'loopback';
const gateway = await createGateway({ port, keepsakesPort, profile, hostname, networkMode, runtime, native: profile === 'development' });
console.log(
  `Relay listening on ${gateway.origin}; enrollment/login location saved in the configured state directory.${gateway.nativeService ? ` Native Keepsakes PID ${gateway.nativeService.pid}.` : ''}`,
);
let closing = false;
for (const signal of ["SIGINT", "SIGTERM"])
  process.on(signal, async () => {
    if (closing) return;
    closing = true;
    await gateway.close();
    process.exit(0);
  });
