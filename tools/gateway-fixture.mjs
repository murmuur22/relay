// Private test subprocess; communicates only its public loopback origin, never secrets.
import {createGateway} from '../server/gateway.mjs';
const gateway=await createGateway({port:0,runtime:process.env.RELAY_TEST_RUNTIME});
process.send?.({origin:gateway.origin});
process.on('SIGTERM',async()=>{await gateway.close();process.exit(0);});
