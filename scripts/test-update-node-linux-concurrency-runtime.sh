#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
UPDATER="$ROOT_DIR/deploy/update-node.sh"

[[ "$(id -u)" -eq 0 ]] || {
  echo "Le harnais Linux doit etre lance avec sudo." >&2
  exit 1
}
[[ -f "$UPDATER" ]] || { echo "Updater introuvable: $UPDATER" >&2; exit 1; }

for tool in awk bash curl find flock jq python3 unshare; do
  command -v "$tool" >/dev/null 2>&1 || {
    echo "Outil de harnais introuvable: $tool" >&2
    exit 1
  }
done

# Isole tout montage eventuellement ajoute par une evolution future du harnais.
if [[ "${CST_UPDATE_LINUX_CONCURRENCY_NS:-0}" != "1" ]]; then
  exec unshare --mount --propagation private \
    env CST_UPDATE_LINUX_CONCURRENCY_NS=1 bash "$0"
fi

TMP_ROOT="$(mktemp -d -t cst-update-linux-concurrency.XXXXXX)"
CHILD_PIDS=()
ASSERTIONS=0

cleanup() {
  local pid
  [[ -n "${ALLOW_CONTENDER_CLEANUP:-}" ]] && : >"$ALLOW_CONTENDER_CLEANUP"
  for pid in "${CHILD_PIDS[@]:-}"; do
    kill "$pid" 2>/dev/null || true
  done
  for pid in "${CHILD_PIDS[@]:-}"; do
    wait "$pid" 2>/dev/null || true
  done
  rm -rf -- "$TMP_ROOT"
}
trap cleanup EXIT

check() {
  local message="$1"
  shift
  if ! "$@"; then
    echo "Assertion echouee: $message" >&2
    exit 1
  fi
  ASSERTIONS=$((ASSERTIONS + 1))
}

wait_for_file() {
  local path="$1" pid="$2" description="$3" attempt
  for attempt in {1..300}; do
    [[ -e "$path" ]] && return 0
    if ! kill -0 "$pid" 2>/dev/null; then
      echo "$description: le processus $pid s'est arrete avant le signal." >&2
      return 1
    fi
    sleep 0.05
  done
  echo "$description: signal non recu." >&2
  return 1
}

write_fake_commands() {
  local fake_bin="$1"
  mkdir -p "$fake_bin"

  cat >"$fake_bin/install" <<'EOF'
#!/usr/bin/env bash
set -euo pipefail
args=()
while [[ $# -gt 0 ]]; do
  case "$1" in
    -o|-g) shift 2 ;;
    *) args+=("$1"); shift ;;
  esac
done
exec /usr/bin/install "${args[@]}"
EOF

  cat >"$fake_bin/chown" <<'EOF'
#!/usr/bin/env bash
exit 0
EOF

  cat >"$fake_bin/runuser" <<'EOF'
#!/usr/bin/env bash
set -euo pipefail
printf 'runuser role=%s %s\n' "$CST_HARNESS_ROLE" "$*" >>"$CST_HARNESS_COMMAND_LOG"
exit 0
EOF

  cat >"$fake_bin/systemctl" <<'EOF'
#!/usr/bin/env bash
set -euo pipefail
[[ "${1:-}" == "restart" && "${2:-}" == "codex-switch-terminal.service" ]]
printf 'systemctl role=%s %s\n' "$CST_HARNESS_ROLE" "$*" >>"$CST_HARNESS_COMMAND_LOG"
/usr/bin/curl -fsS --max-time 3 -X POST \
  "$CST_HARNESS_BASE/__harness/restart" >/dev/null
if [[ "$CST_HARNESS_ROLE" == "winner" ]]; then
  : >"$CST_HARNESS_WINNER_LOCKED"
  for _attempt in {1..300}; do
    [[ -e "$CST_HARNESS_CONTENDER_PAUSED" ]] && exit 0
    sleep 0.05
  done
  echo "Le contender n'a pas atteint son cleanup sous contention." >&2
  exit 1
fi
EOF

  # Le contender reste vivant juste avant de retirer son marqueur. Le gagnant
  # peut alors prouver que la purge conserve une release reellement en cours.
  cat >"$fake_bin/rm" <<'EOF'
#!/usr/bin/env bash
set -euo pipefail
if [[ "${CST_HARNESS_ROLE:-}" == "contender" ]]; then
  for argument in "$@"; do
    if [[ "$argument" == */.update-in-progress ]]; then
      : >"$CST_HARNESS_CONTENDER_PAUSED"
      for _attempt in {1..300}; do
        [[ -e "$CST_HARNESS_ALLOW_CONTENDER_CLEANUP" ]] && break
        sleep 0.05
      done
      [[ -e "$CST_HARNESS_ALLOW_CONTENDER_CLEANUP" ]] || {
        echo "Le cleanup du contender n'a pas ete libere." >&2
        exit 1
      }
      break
    fi
  done
fi
exec /usr/bin/rm "$@"
EOF

  chmod 0755 "$fake_bin/install" "$fake_bin/chown" "$fake_bin/runuser" \
    "$fake_bin/systemctl" "$fake_bin/rm"
}

write_server() {
  local server_path="$1"
  cat >"$server_path" <<'PY'
import json
import os
import sys
import threading
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

app_dir, port_file, event_file = sys.argv[1:]
state = {
    "version": "1.0.0",
    "commit": "stable-old",
    "draining": False,
}
lock = threading.Lock()


def record(kind, **fields):
    with lock:
        with open(event_file, "a", encoding="utf-8") as stream:
            stream.write(json.dumps({"kind": kind, **fields}, sort_keys=True) + "\n")


def release_identity():
    marker = os.path.join(app_dir, "current", "dist", "harness-release.txt")
    with open(marker, encoding="utf-8") as stream:
        version, commit = stream.read().strip().split("|", 1)
    return version, commit, os.path.realpath(os.path.join(app_dir, "current"))


class Handler(BaseHTTPRequestHandler):
    def log_message(self, _format, *_args):
        return

    def json_response(self, status, payload):
        body = json.dumps(payload).encode()
        self.send_response(status)
        self.send_header("content-type", "application/json")
        self.send_header("content-length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def authorized(self):
        return self.headers.get("authorization") == "Bearer harness-token"

    def do_GET(self):
        if self.path == "/api/chat/turns/active":
            if not self.authorized():
                record("unauthorized", path=self.path)
                self.json_response(401, {"error": "unauthorized"})
                return
            record("chat", active=0)
            self.json_response(200, [])
            return

        if self.path != "/healthz":
            self.json_response(404, {"error": "not found"})
            return
        with lock:
            payload = {
                "activeTerminals": 0,
                "commit": state["commit"],
                "draining": state["draining"],
                "ready": True,
                "version": state["version"],
            }
        record("health", **payload)
        self.json_response(200, payload)

    def do_POST(self):
        if self.path == "/__harness/restart":
            version, commit, target = release_identity()
            with lock:
                state.update(version=version, commit=commit, draining=False)
            record("restart", target=target, version=version, commit=commit)
            self.json_response(200, {"ok": True})
            return

        if not self.authorized():
            record("unauthorized", path=self.path)
            self.json_response(401, {"error": "unauthorized"})
            return

        if self.path == "/api/admin/drain":
            length = int(self.headers.get("content-length", "0"))
            payload = json.loads(self.rfile.read(length) or b"{}")
            with lock:
                state["draining"] = bool(payload.get("draining"))
            record("drain", value=state["draining"], ttl=payload.get("ttlSeconds"))
            self.json_response(200, {"draining": state["draining"]})
            return

        if self.path == "/api/terminals":
            with lock:
                draining = state["draining"]
                commit = state["commit"]
            status = 503 if draining else 400
            record("terminal", status=status, commit=commit)
            self.json_response(status, {"error": "harness probe"})
            return

        self.json_response(404, {"error": "not found"})


server = ThreadingHTTPServer(("127.0.0.1", 0), Handler)
with open(port_file, "w", encoding="ascii") as stream:
    stream.write(str(server.server_address[1]))
record("server", port=server.server_address[1])
server.serve_forever()
PY
}

app="$TMP_ROOT/app"
source_dir="$TMP_ROOT/source"
fake_bin="$TMP_ROOT/fake-bin"
server="$TMP_ROOT/server.py"
port_file="$TMP_ROOT/port"
events="$TMP_ROOT/events.jsonl"
env_file="$TMP_ROOT/codex-switch-terminal.env"
command_log="$TMP_ROOT/commands.log"
winner_log="$TMP_ROOT/winner.log"
contender_log="$TMP_ROOT/contender.log"
WINNER_LOCKED="$TMP_ROOT/winner-locked"
CONTENDER_PAUSED="$TMP_ROOT/contender-cleanup-paused"
ALLOW_CONTENDER_CLEANUP="$TMP_ROOT/allow-contender-cleanup"
candidate_commit="candidate-concurrent"

mkdir -p \
  "$app/releases/1.0.0-stable-old/dist" \
  "$app/releases/0.9.0-obsolete/dist" \
  "$app/releases/0.8.0-stale-marker/dist" \
  "$app/build-cache/server" \
  "$source_dir/src-tauri" \
  "$source_dir/dist"
printf '1.0.0|stable-old\n' >"$app/releases/1.0.0-stable-old/dist/harness-release.txt"
printf '0.9.0|obsolete\n' >"$app/releases/0.9.0-obsolete/dist/harness-release.txt"
printf '0.8.0|stale-marker\n' >"$app/releases/0.8.0-stale-marker/dist/harness-release.txt"
printf '99999999|1\n' >"$app/releases/0.8.0-stale-marker/.update-in-progress"
printf '2.0.0|%s\n' "$candidate_commit" >"$source_dir/dist/harness-release.txt"
printf '<title>candidate concurrente</title>\n' >"$source_dir/dist/index.html"
ln -s "releases/1.0.0-stable-old" "$app/current"

cat >"$app/build-cache/server/cst-server" <<EOF
#!/usr/bin/env bash
if [[ "\${1:-}" == "--version" ]]; then
  echo "cst-server 2.0.0 ($candidate_commit)"
  exit 0
fi
exit 2
EOF
chmod 0755 "$app/build-cache/server/cst-server"

: >"$events"
: >"$command_log"
write_fake_commands "$fake_bin"
write_server "$server"
python3 "$server" "$app" "$port_file" "$events" &
server_pid=$!
CHILD_PIDS+=("$server_pid")

for attempt in {1..100}; do
  [[ -s "$port_file" ]] && break
  kill -0 "$server_pid" 2>/dev/null || { echo "Le faux service Linux s'est arrete." >&2; exit 1; }
  sleep 0.05
done
check "le faux service n'a pas publie son port" test -s "$port_file"
port="$(<"$port_file")"
printf 'CST_ADMIN_TOKEN="harness-token"\nCST_BIND="127.0.0.1:%s"\n' "$port" >"$env_file"

run_updater() {
  local role="$1" output="$2"
  env \
    PATH="$fake_bin:/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin" \
    CST_APP_DIR="$app" \
    CST_SOURCE_DIR="$source_dir" \
    CST_ENV_FILE="$env_file" \
    CST_VERIFY_TIMEOUT=5 \
    CST_GIT_COMMIT="$candidate_commit" \
    CST_HARNESS_ROLE="$role" \
    CST_HARNESS_BASE="http://127.0.0.1:$port" \
    CST_HARNESS_COMMAND_LOG="$command_log" \
    CST_HARNESS_WINNER_LOCKED="$WINNER_LOCKED" \
    CST_HARNESS_CONTENDER_PAUSED="$CONTENDER_PAUSED" \
    CST_HARNESS_ALLOW_CONTENDER_CLEANUP="$ALLOW_CONTENDER_CLEANUP" \
    bash "$UPDATER" \
      --source "$TMP_ROOT/source-archive-absent.tar.gz" \
      --drain-timeout 10 \
      --drain-lease 5 >"$output" 2>&1
}

run_updater winner "$winner_log" &
winner_pid=$!
CHILD_PIDS+=("$winner_pid")
check "le gagnant n'a pas atteint la bascule sous mutex" \
  wait_for_file "$WINNER_LOCKED" "$winner_pid" "attente du mutex gagnant"

run_updater contender "$contender_log" &
contender_pid=$!
CHILD_PIDS+=("$contender_pid")
check "le contender n'a pas atteint le cleanup apres contention" \
  wait_for_file "$CONTENDER_PAUSED" "$contender_pid" "attente du contender"

set +e
wait "$winner_pid"
winner_status=$?
set -e
check "le premier updater n'a pas reussi" test "$winner_status" -eq 0
check "le contender n'est plus vivant pendant la verification du marqueur" kill -0 "$contender_pid"

mapfile -t active_markers < <(find "$app/releases" -type f -name .update-in-progress -print)
check "la release concurrente active n'a pas conserve exactement un marqueur" \
  test "${#active_markers[@]}" -eq 1
IFS='|' read -r marker_pid marker_start <"${active_markers[0]}"
check "le marqueur actif ne reference pas un processus Linux vivant" kill -0 "$marker_pid"
actual_start="$(awk '{print $22}' "/proc/$marker_pid/stat")"
check "le marqueur actif ne porte pas l'identite de processus attendue" \
  test "$actual_start" = "$marker_start"
protected_release="$(basename "$(dirname "${active_markers[0]}")")"
check "la purge n'a pas trace la protection de la release active" \
  grep -Fq "Release conservee car une mise a jour l'utilise: $protected_release" "$winner_log"
check "la release au marqueur perime n'a pas ete purgee" \
  test ! -e "$app/releases/0.8.0-stale-marker"
check "l'ancienne release stable n'a pas ete purgee apres verification" \
  test ! -e "$app/releases/1.0.0-stable-old"
check "la release obsolete sans marqueur n'a pas ete purgee" \
  test ! -e "$app/releases/0.9.0-obsolete"

current_release="$(basename "$(readlink -f "$app/current")")"
check "current ne cible pas la candidate gagnante" test "$current_release" = "2.0.0-$candidate_commit"
restart_count="$(jq -s '[.[] | select(.kind == "restart")] | length' "$events")"
drain_count="$(jq -s '[.[] | select(.kind == "drain" and .value == true and .ttl == 5)] | length' "$events")"
terminal_count="$(jq -s '[.[] | select(.kind == "terminal" and .status == 400)] | length' "$events")"
unauthorized_count="$(jq -s '[.[] | select(.kind == "unauthorized")] | length' "$events")"
check "la contention a provoque plusieurs redemarrages" test "$restart_count" -eq 1
check "la contention a provoque plusieurs drains ou une lease incorrecte" test "$drain_count" -eq 1
check "la sonde d'acceptation non drainee n'a pas abouti" test "$terminal_count" -ge 1
check "une requete runtime a perdu son authentification" test "$unauthorized_count" -eq 0
check "les deux updaters n'ont pas execute leur phase de build" \
  test "$(grep -c '^runuser role=' "$command_log")" -eq 2
check "plus d'un updater a redemarre le service" \
  test "$(grep -c '^systemctl role=' "$command_log")" -eq 1

: >"$ALLOW_CONTENDER_CLEANUP"
set +e
wait "$contender_pid"
contender_status=$?
set -e
check "le contender ne signale pas la contention avec le statut 4" \
  test "$contender_status" -eq 4
check "le message de contention du second updater est absent" \
  grep -Fq "Une autre mise a jour effectue deja la courte bascule" "$contender_log"
check "la release abandonnee du contender subsiste" \
  test "$(find "$app/releases" -mindepth 1 -maxdepth 1 -type d | wc -l)" -eq 1
check "un marqueur de mise a jour residuel subsiste" \
  test "$(find "$app/releases" -type f -name .update-in-progress | wc -l)" -eq 0
check "un lien current.tmp residuel subsiste" test ! -e "$app/current.tmp"
check "le mutex n'est pas reutilisable apres les deux sorties" \
  flock -n "$app/.update.lock" /usr/bin/true

kill "$server_pid" 2>/dev/null || true
wait "$server_pid" 2>/dev/null || true
proof_root="$TMP_ROOT"
rm -rf -- "$proof_root"
trap - EXIT
check "le dossier temporaire du harnais subsiste" test ! -e "$proof_root"

printf '[linux-update-concurrency-runtime] OK: 2 updaters, %s assertions, mutex et marqueurs valides\n' "$ASSERTIONS"
