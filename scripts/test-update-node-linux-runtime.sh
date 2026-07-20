#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
UPDATER="$ROOT_DIR/deploy/update-node.sh"

[[ "$(id -u)" -eq 0 ]] || {
  echo "Le harnais Linux doit etre lance avec sudo." >&2
  exit 1
}
[[ -f "$UPDATER" ]] || { echo "Updater introuvable: $UPDATER" >&2; exit 1; }

for tool in bash curl jq python3 unshare; do
  command -v "$tool" >/dev/null 2>&1 || {
    echo "Outil de harnais introuvable: $tool" >&2
    exit 1
  }
done

# Le namespace rend l'execution locale explicitement isolee de tout montage
# eventuellement ajoute par le script ou par une evolution future du harnais.
if [[ "${CST_UPDATE_LINUX_HARNESS_NS:-0}" != "1" ]]; then
  exec unshare --mount --propagation private \
    env CST_UPDATE_LINUX_HARNESS_NS=1 bash "$0"
fi

TMP_ROOT="$(mktemp -d -t cst-update-linux-runtime.XXXXXX)"
SERVER_PIDS=()
ASSERTIONS=0
SCENARIOS=0

cleanup() {
  local pid
  for pid in "${SERVER_PIDS[@]:-}"; do
    kill "$pid" 2>/dev/null || true
    wait "$pid" 2>/dev/null || true
  done
  rm -rf -- "$TMP_ROOT"
}
trap cleanup EXIT

check() {
  local condition="$1" message="$2"
  if ! eval "$condition"; then
    echo "Assertion echouee: $message" >&2
    exit 1
  fi
  ASSERTIONS=$((ASSERTIONS + 1))
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
printf '%s\n' "$*" >>"$CST_HARNESS_COMMAND_LOG"
exit 0
EOF

  cat >"$fake_bin/systemctl" <<'EOF'
#!/usr/bin/env bash
set -euo pipefail
[[ "${1:-}" == "restart" && "${2:-}" == "codex-switch-terminal.service" ]]
printf 'systemctl %s\n' "$*" >>"$CST_HARNESS_COMMAND_LOG"
/usr/bin/curl -fsS --max-time 3 -X POST \
  "$CST_HARNESS_BASE/__harness/restart" >/dev/null
EOF

  chmod 0755 "$fake_bin/install" "$fake_bin/chown" \
    "$fake_bin/runuser" "$fake_bin/systemctl"
}

write_server() {
  local server_path="$1"
  cat >"$server_path" <<'PY'
import json
import os
import sys
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

app_dir, scenario, candidate_commit, port_file, event_file = sys.argv[1:]
state = {
    "version": "1.0.0",
    "commit": "stable-old",
    "draining": False,
    "busy_health_checks": 2,
    "busy_chat_checks": 4 if scenario == "success" else 0,
}


def record(kind, **fields):
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
            if scenario == "chat-api-unavailable":
                record("chat_error", mode="unavailable")
                self.json_response(503, {"error": "chat API unavailable"})
                return
            if scenario == "chat-api-malformed":
                record("chat_error", mode="malformed")
                self.json_response(200, {"activeTurns": []})
                return
            active = 1 if state["busy_chat_checks"] > 0 else 0
            if state["busy_chat_checks"] > 0:
                state["busy_chat_checks"] -= 1
            record("chat", active=active)
            self.json_response(
                200,
                [{"id": 42, "status": "running"}] if active else [],
            )
            return

        if self.path != "/healthz":
            self.json_response(404, {"error": "not found"})
            return
        active = 1 if state["busy_health_checks"] > 0 else 0
        if state["busy_health_checks"] > 0:
            state["busy_health_checks"] -= 1
        payload = {
            "activeTerminals": active,
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
            runtime_commit = commit
            if scenario == "rollback" and commit == candidate_commit:
                runtime_commit = "runtime-mismatch"
            state.update(version=version, commit=runtime_commit, draining=False)
            record(
                "restart",
                target=target,
                version=version,
                commit=runtime_commit,
                release_commit=commit,
            )
            self.json_response(200, {"ok": True})
            return

        if not self.authorized():
            record("unauthorized", path=self.path)
            self.json_response(401, {"error": "unauthorized"})
            return

        if self.path == "/api/admin/drain":
            length = int(self.headers.get("content-length", "0"))
            payload = json.loads(self.rfile.read(length) or b"{}")
            state["draining"] = bool(payload.get("draining"))
            record("drain", value=state["draining"], ttl=payload.get("ttlSeconds"))
            self.json_response(200, {"draining": state["draining"]})
            return

        if self.path == "/api/terminals":
            status = 503 if state["draining"] else 400
            record("terminal", status=status, commit=state["commit"])
            self.json_response(status, {"error": "harness probe"})
            return

        self.json_response(404, {"error": "not found"})


server = ThreadingHTTPServer(("127.0.0.1", 0), Handler)
with open(port_file, "w", encoding="ascii") as stream:
    stream.write(str(server.server_address[1]))
record("server", port=server.server_address[1], scenario=scenario)
server.serve_forever()
PY
}

verify_scenario() {
  local scenario="$1" scenario_dir="$2" candidate_commit="$3"
  python3 - "$scenario" "$scenario_dir" "$candidate_commit" <<'PY'
import json
import os
import sys

scenario, root, candidate_commit = sys.argv[1:]
app = os.path.join(root, "app")
with open(os.path.join(root, "events.jsonl"), encoding="utf-8") as stream:
    events = [json.loads(line) for line in stream if line.strip()]
with open(os.path.join(root, "updater.log"), encoding="utf-8") as stream:
    output = stream.read()
with open(os.path.join(root, "commands.log"), encoding="utf-8") as stream:
    commands = stream.read()

assertions = 0


def check(value, message):
    global assertions
    if not value:
        raise AssertionError(message)
    assertions += 1


def first_index(kind, predicate=lambda _event: True, after=-1):
    return next(
        (index for index, event in enumerate(events)
         if index > after and event["kind"] == kind and predicate(event)),
        -1,
    )


api_failure_messages = {
    "chat-api-unavailable": "Impossible de verifier les tours de chat actifs",
    "chat-api-malformed": "Reponse invalide pour les tours de chat actifs",
}
is_api_failure = scenario in api_failure_messages
drain_true = [event for event in events if event["kind"] == "drain" and event["value"]]
restarts = [event for event in events if event["kind"] == "restart"]

if is_api_failure:
    expected_mode = scenario.removeprefix("chat-api-")
    chat_errors = [event for event in events if event["kind"] == "chat_error"]
    check(len(chat_errors) == 1 and chat_errors[0]["mode"] == expected_mode,
          "la panne attendue de l'API chat n'a pas ete injectee")
    check(any(event["kind"] == "health" for event in events),
          "l'updater n'a pas sonde le service avant l'abandon")
    check(not any(event["kind"] == "unauthorized" for event in events),
          "la requete chat degradee a perdu son authentification")
    check(not drain_true and not any(event["kind"] == "drain" for event in events),
          "un drain a ete arme malgre l'echec de l'API chat")
    check(not restarts and "systemctl restart" not in commands,
          "un redemarrage a eu lieu malgre l'echec de l'API chat")
    check(not any(event["kind"] == "terminal" for event in events),
          "une sonde post-bascule a eu lieu malgre l'abandon preventif")
    check(os.path.basename(os.path.realpath(os.path.join(app, "current"))) == "1.0.0-stable-old",
          "current a bascule malgre l'echec de l'API chat")
    releases = sorted(os.listdir(os.path.join(app, "releases")))
    check(releases == ["0.9.0-stale", "1.0.0-stable-old"],
          "la candidate abandonnee n'a pas ete nettoyee ou une release stable a ete supprimee")
    check(api_failure_messages[scenario] in output
          and "mise a jour annulee sans redemarrage" in output,
          "l'abandon ferme de la mise a jour n'est pas trace")
    check("Bascule current" not in output and "Redemarrage de" not in output,
          "les etapes de bascule ont commence malgre l'echec de l'API chat")
else:
    first_drain = first_index("drain", lambda event: event["value"])
    first_idle = first_index("health", lambda event: event["activeTerminals"] == 0)
    check(any(event["kind"] == "health" and event["activeTerminals"] == 1 for event in events),
          "la phase d'attente occupee n'a pas ete observee")
    check(first_idle >= 0 and first_idle < first_drain,
          "le drain a ete arme avant l'instant libre")
    check(len(drain_true) == 1 and drain_true[0]["ttl"] == 5,
          "la lease de drain bornee n'a pas ete posee exactement une fois")
    check(not any(event["kind"] == "unauthorized" for event in events),
          "une requete runtime a perdu son authentification")

if scenario == "success":
    busy_chat_after_terminal_idle = first_index(
        "chat", lambda event: event["active"] == 1, first_idle,
    )
    idle_chat = first_index(
        "chat", lambda event: event["active"] == 0, busy_chat_after_terminal_idle,
    )
    check(busy_chat_after_terminal_idle > first_idle,
          "aucun tour de chat actif n'a ete observe apres la fin des terminaux")
    check(idle_chat > busy_chat_after_terminal_idle and idle_chat < first_drain,
          "le drain a commence avant la fin du tour de chat actif")
    check(len(restarts) == 1 and restarts[0]["release_commit"] == candidate_commit,
          "la release candidate n'a pas ete redemarree une seule fois")
    restart_index = first_index("restart")
    healthy_index = first_index(
        "health",
        lambda event: event["commit"] == candidate_commit
        and event["ready"] is True and event["draining"] is False,
    )
    check(first_drain < restart_index < healthy_index,
          "l'ordre drain, restart, verification saine est incorrect")
    check(first_index("terminal", lambda event: event["commit"] == candidate_commit) > healthy_index,
          "la sonde d'acceptation candidate n'a pas ete executee")
    check(os.path.basename(os.path.realpath(os.path.join(app, "current"))).endswith(candidate_commit),
          "current ne cible pas la candidate validee")
    releases = sorted(os.listdir(os.path.join(app, "releases")))
    check(len(releases) == 1 and releases[0].endswith(candidate_commit),
          "les anciennes releases n'ont pas ete purgees apres succes")
    check("OK : noeud en 2.0.0" in output and "2 ancienne(s) release(s)" in output,
          "le succes et la purge ne sont pas traces")
elif scenario == "rollback":
    check(len(restarts) == 2,
          "le scenario d'echec n'a pas produit candidate puis rollback")
    check(restarts[0]["release_commit"] == candidate_commit
          and restarts[0]["commit"] == "runtime-mismatch",
          "l'echec apres bascule n'a pas ete injecte")
    check(restarts[1]["release_commit"] == "stable-old"
          and restarts[1]["commit"] == "stable-old",
          "le rollback n'a pas restaure le runtime stable")
    check(first_drain < first_index("restart") < first_index("restart", lambda event: event["release_commit"] == "stable-old"),
          "l'ordre drain, bascule, rollback est incorrect")
    check(first_index("terminal", lambda event: event["commit"] == "stable-old") > first_index("restart", lambda event: event["release_commit"] == "stable-old"),
          "le rollback n'a pas passe la sonde d'acceptation")
    check(os.path.basename(os.path.realpath(os.path.join(app, "current"))) == "1.0.0-stable-old",
          "current n'a pas ete restaure vers la release stable")
    releases = sorted(os.listdir(os.path.join(app, "releases")))
    check(releases == ["0.9.0-stale", "1.0.0-stable-old"],
          "la candidate echouee n'a pas ete purgee ou une release stable a ete supprimee")
    check("ECHEC de la verification" in output and "Rollback OK" in output,
          "l'echec et le rollback reussi ne sont pas traces")

check(not os.path.lexists(os.path.join(app, "current.tmp")),
      "un lien current.tmp residuel subsiste")
markers = []
for directory, _subdirs, files in os.walk(os.path.join(app, "releases")):
    if ".update-in-progress" in files:
        markers.append(os.path.join(directory, ".update-in-progress"))
check(not markers, "un marqueur de mise a jour residuel subsiste")
if not is_api_failure:
    check(any(event["kind"] == "terminal" and event["status"] == 400 for event in events),
          "aucune sonde d'acceptation non drainee n'a abouti")

print(assertions)
PY
}

run_scenario() {
  local scenario="$1" candidate_commit="$2" expected_status="$3"
  local scenario_dir="$TMP_ROOT/$scenario"
  local app="$scenario_dir/app"
  local source="$scenario_dir/source"
  local fake_bin="$scenario_dir/fake-bin"
  local server="$scenario_dir/server.py"
  local port_file="$scenario_dir/port"
  local events="$scenario_dir/events.jsonl"
  local env_file="$scenario_dir/codex-switch-terminal.env"
  local command_log="$scenario_dir/commands.log"
  local updater_log="$scenario_dir/updater.log"
  local port pid status scenario_assertions attempt

  mkdir -p \
    "$app/releases/1.0.0-stable-old/dist" \
    "$app/releases/0.9.0-stale/dist" \
    "$app/build-cache/server" \
    "$source/src-tauri" \
    "$source/dist"
  printf '1.0.0|stable-old\n' >"$app/releases/1.0.0-stable-old/dist/harness-release.txt"
  printf '0.9.0|stale\n' >"$app/releases/0.9.0-stale/dist/harness-release.txt"
  printf '2.0.0|%s\n' "$candidate_commit" >"$source/dist/harness-release.txt"
  printf '<title>candidate</title>\n' >"$source/dist/index.html"
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
  python3 "$server" "$app" "$scenario" "$candidate_commit" "$port_file" "$events" &
  pid=$!
  SERVER_PIDS+=("$pid")

  for attempt in {1..100}; do
    [[ -s "$port_file" ]] && break
    kill -0 "$pid" 2>/dev/null || { echo "Le faux service Linux s'est arrete." >&2; exit 1; }
    sleep 0.05
  done
  check '[[ -s "$port_file" ]]' "le faux service n'a pas publie son port"
  port="$(<"$port_file")"
  printf 'CST_ADMIN_TOKEN="harness-token"\nCST_BIND="127.0.0.1:%s"\n' "$port" >"$env_file"

  set +e
  env \
    PATH="$fake_bin:/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin" \
    CST_APP_DIR="$app" \
    CST_SOURCE_DIR="$source" \
    CST_ENV_FILE="$env_file" \
    CST_VERIFY_TIMEOUT=3 \
    CST_GIT_COMMIT="$candidate_commit" \
    CST_HARNESS_BASE="http://127.0.0.1:$port" \
    CST_HARNESS_COMMAND_LOG="$command_log" \
    bash "$UPDATER" \
      --source "$scenario_dir/source-archive-absent.tar.gz" \
      --drain-timeout 10 \
      --drain-lease 5 >"$updater_log" 2>&1
  status=$?
  set -e

  kill "$pid" 2>/dev/null || true
  wait "$pid" 2>/dev/null || true
  check '[[ "$status" -eq "$expected_status" ]]' \
    "$scenario devait sortir avec $expected_status, obtenu $status"

  scenario_assertions="$(verify_scenario "$scenario" "$scenario_dir" "$candidate_commit")"
  ASSERTIONS=$((ASSERTIONS + scenario_assertions))
  SCENARIOS=$((SCENARIOS + 1))
  printf '[linux-update-runtime] %s: OK (%s assertions)\n' "$scenario" "$((scenario_assertions + 2))"
}

run_scenario success candidate-good 0
run_scenario rollback candidate-bad 1
run_scenario chat-api-unavailable candidate-chat-unavailable 1
run_scenario chat-api-malformed candidate-chat-malformed 1

proof_root="$TMP_ROOT"
rm -rf -- "$proof_root"
trap - EXIT
check '[[ ! -e "$proof_root" ]]' "le dossier temporaire du harnais subsiste"

printf '[linux-update-runtime] OK: %s scenarios, %s assertions, aucun residu temporaire\n' \
  "$SCENARIOS" "$ASSERTIONS"
