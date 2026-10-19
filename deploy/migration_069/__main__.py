from . import control_plane_upgrade_069 as c
from .coordinator_069 import main
import sys
try:
    sys.exit(main())
except c.Refused as error:
    print('REFUSED: '+str(error),file=sys.stderr); sys.exit(1)
except Exception:
    print('REFUSED: bounded operation failed; private details suppressed; retain protected recovery if activation began.',file=sys.stderr); sys.exit(1)
