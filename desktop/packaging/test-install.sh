#!/usr/bin/env bash
# Grafeno Desktop and the Grafeno engine, installed side by side in clean
# containers (engine phase 15.5): the desktop package brings no service
# and no engine; installing, upgrading and removing either leaves the
# other, and the engine's data, untouched.
#
#   docker build -f desktop/packaging/Dockerfile --output dist/desktop .
#   desktop/packaging/test-install.sh DESKTOP_DIST ENGINE_DIST [image ...]
#
# DESKTOP_DIST holds the desktop's .deb and .rpm; ENGINE_DIST the engine's
# (the engine repository's dist/linux). Default images: debian:12 (the
# .deb) and fedora:42 (the .rpm). Needs Docker.
set -euo pipefail
export MSYS_NO_PATHCONV=1
DESKTOP="$(cd "${1:?DESKTOP_DIST}" && pwd)"
ENGINE="$(cd "${2:?ENGINE_DIST}" && pwd)"
shift 2
IMAGES=("$@")
[ ${#IMAGES[@]} -gt 0 ] || IMAGES=(debian:12 fedora:42)
host_path() { if command -v cygpath >/dev/null 2>&1; then cygpath -w "$1"; else printf '%s' "$1"; fi; }

read -r -d '' CHECK <<'SCRIPT' || true
set -eu
not() { if "$@"; then echo "unexpectedly true: $*"; exit 1; fi; }
if command -v apt-get >/dev/null 2>&1; then
    kind=deb
    apt-get update -qq >/dev/null
    desktop_pkg="$(ls /desktop/*_amd64.deb | head -1)"
    engine_pkg=/engine/grafeno-linux-amd64.deb
    install() { DEBIAN_FRONTEND=noninteractive apt-get install -y -qq "$@" >/dev/null 2>&1; }
    remove() { DEBIAN_FRONTEND=noninteractive apt-get remove -y -qq "$1" >/dev/null 2>&1; }
    files() { dpkg -L "$1"; }
    # A removed package keeps its configuration files: only "installed" counts.
    installed() { dpkg-query -W -f '${Status}' "$1" 2>/dev/null | grep -q 'install ok installed'; }
    depends() { dpkg-query -W -f '${Depends}' "$1"; }
else
    kind=rpm
    desktop_pkg="$(ls /desktop/*.x86_64.rpm | head -1)"
    engine_pkg=/engine/grafeno-linux-x86_64.rpm
    install() { dnf install -y -q --nogpgcheck "$@" >/dev/null 2>&1; }
    remove() { dnf remove -y -q "$1" >/dev/null 2>&1; }
    files() { rpm -ql "$1"; }
    installed() { rpm -q "$1" >/dev/null 2>&1; }
    depends() { rpm -qR "$1"; }
fi
cp "$desktop_pkg" /tmp/ && cp "$engine_pkg" /tmp/
desktop_pkg="/tmp/$(basename "$desktop_pkg")"; engine_pkg="/tmp/$(basename "$engine_pkg")"
chmod 0644 /tmp/*.deb /tmp/*.rpm 2>/dev/null || true
name="grafeno-desktop"

echo "-- the desktop alone: no service, no engine"
install "$desktop_pkg"
installed "$name"
files "$name" | grep -q '/usr/bin/grafeno-desktop'
if files "$name" | grep -Eq '\.service$|/usr/bin/grafeno$|/etc/grafeno'; then
    echo "the desktop package carries engine or service files:"; files "$name"; exit 1
fi
if depends "$name" | grep -Eq '(^|[ ,])grafeno([ ,(]|$)'; then
    echo "the desktop package depends on the engine: $(depends "$name")"; exit 1
fi
test ! -e /usr/bin/grafeno
not getent passwd grafeno
test ! -e /lib/systemd/system/grafeno.service && test ! -e /usr/lib/systemd/system/grafeno.service

echo "-- the engine beside it"
install "$engine_pkg"
installed grafeno && installed "$name"
test -x /usr/bin/grafeno && test -x /usr/bin/grafeno-desktop
grafeno setup --instance notes --unattended --no-admin --quiet --data /var/lib/grafeno/notes
data_before="$(sha256sum /var/lib/grafeno/notes/grafeno.redb /etc/grafeno/notes.toml /etc/grafeno/grafeno.toml)"

echo "-- removing the desktop leaves the engine and its data"
remove "$name"
not installed "$name"
installed grafeno && test -x /usr/bin/grafeno
test "$(sha256sum /var/lib/grafeno/notes/grafeno.redb /etc/grafeno/notes.toml /etc/grafeno/grafeno.toml)" = "$data_before"

echo "-- installing it again, and upgrading it over itself, leave them too"
install "$desktop_pkg"
if [ "$kind" = deb ]; then
    DEBIAN_FRONTEND=noninteractive apt-get install -y -qq --reinstall "$desktop_pkg" >/dev/null 2>&1
else
    dnf reinstall -y -q --nogpgcheck "$desktop_pkg" >/dev/null 2>&1
fi
test "$(sha256sum /var/lib/grafeno/notes/grafeno.redb /etc/grafeno/notes.toml /etc/grafeno/grafeno.toml)" = "$data_before"
installed grafeno

echo "-- removing the engine leaves the desktop, and the data"
remove grafeno
not installed grafeno
test ! -e /usr/bin/grafeno
installed "$name" && test -x /usr/bin/grafeno-desktop
test -f /var/lib/grafeno/notes/grafeno.redb
echo "OK"
SCRIPT

failed=0
for image in "${IMAGES[@]}"; do
    echo "== $image"
    log="$(mktemp)"
    if docker run --rm -v "$(host_path "$DESKTOP"):/desktop:ro" -v "$(host_path "$ENGINE"):/engine:ro" \
        "$image" bash -c "$CHECK" >"$log" 2>&1; then
        grep '^--' "$log" | sed 's/^/   /'
        echo "   passed"
    else
        echo "   FAILED:"; tail -25 "$log" | sed 's/^/   /'; failed=1
    fi
    rm -f "$log"
done
exit "$failed"
