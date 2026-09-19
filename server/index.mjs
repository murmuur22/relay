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
const gateway = await createGateway({ port, keepsakesPort, native: true });
console.log(
  `Relay listening on ${gateway.origin}; unlock using the protected local bootstrap file. Native Keepsakes PID ${gateway.nativeService.pid}.`,
);
let closing = false;
for (const signal of ["SIGINT", "SIGTERM"])
  process.on(signal, async () => {
    if (closing) return;
    closing = true;
    await gateway.close();
    process.exit(0);
  });
