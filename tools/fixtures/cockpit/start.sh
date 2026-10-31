#!/bin/sh
set -eu
mkdir -p /run/dbus /run/cockpit
dbus-daemon --system --fork
# Reproduce the distro's Accept=yes/StandardInput=socket session units without
# privileged Docker, host mounts or a host systemd instance.
systemd-socket-activate --accept --inetd --listen=/run/cockpit/session /usr/lib/cockpit/cockpit-session &
exec /usr/lib/cockpit/cockpit-ws --port=9090 --address=0.0.0.0
