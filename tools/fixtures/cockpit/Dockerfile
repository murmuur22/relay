FROM debian:trixie-slim
LABEL io.relay.fixture="management-cockpit-m2"
RUN apt-get update && DEBIAN_FRONTEND=noninteractive apt-get install -y --no-install-recommends cockpit-ws cockpit-bridge cockpit-system openssl dbus passwd && rm -rf /var/lib/apt/lists/*
RUN useradd --create-home --shell /bin/bash learner && mkdir -p /run/dbus /etc/cockpit/ws-certs.d && openssl req -x509 -newkey rsa:2048 -nodes -days 2 -subj /CN=cockpit.fixture.test -addext subjectAltName=DNS:cockpit.fixture.test,IP:127.0.0.1 -addext basicConstraints=critical,CA:TRUE -keyout /etc/cockpit/ws-certs.d/fixture.key -out /etc/cockpit/ws-certs.d/fixture.cert && chmod 600 /etc/cockpit/ws-certs.d/fixture.key
# Isolated container only: publish its HTTPS port on host loopback; no host mounts.
EXPOSE 9090
COPY start.sh /opt/fixture/start.sh
CMD ["/bin/sh", "/opt/fixture/start.sh"]
