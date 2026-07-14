#!/usr/bin/env bash
set -euo pipefail

usage() {
  cat <<'EOF'
Usage: smoke-vps-runtime.sh <cst-server-binary> [static-dir]

Starts the Linux server in an isolated temporary directory and validates the
authenticated remote chat path with a deterministic mock Codex CLI.
EOF
}

if [[ $# -lt 1 || $# -gt 2 ]]; then
  usage >&2
  exit 2
fi

for command_name in curl git jq; do
  if ! command -v "$command_name" >/dev/null 2>&1; then
    echo "Missing required command: $command_name" >&2
    exit 2
  fi
done

SERVER_BINARY="$(realpath "$1")"
if [[ ! -x "$SERVER_BINARY" ]]; then
  echo "Server binary is not executable: $SERVER_BINARY" >&2
  exit 2
fi

TMP_ROOT="$(mktemp -d "${TMPDIR:-/tmp}/cst-vps-smoke.XXXXXX")"
STATIC_DIR="${2:-$TMP_ROOT/static}"
WORKSPACES_ROOT="$TMP_ROOT/workspaces"
SMOKE_REPO="$WORKSPACES_ROOT/smoke-repo"
mkdir -p "$TMP_ROOT/data" "$TMP_ROOT/codex-home" "$SMOKE_REPO" "$STATIC_DIR"

git -C "$SMOKE_REPO" init -q
printf '%s\n' 'VPS orchestration smoke repository' >"$SMOKE_REPO/README.md"
git -C "$SMOKE_REPO" add README.md
git -C "$SMOKE_REPO" \
  -c user.name='CST VPS Smoke' \
  -c user.email='vps-smoke@codex-switch.local' \
  commit -q -m 'initial smoke state'

SERVER_PID=""
cleanup() {
  if [[ -n "$SERVER_PID" ]] && kill -0 "$SERVER_PID" 2>/dev/null; then
    kill "$SERVER_PID" 2>/dev/null || true
    wait "$SERVER_PID" 2>/dev/null || true
  fi
  if [[ "${CST_KEEP_SMOKE_DATA:-0}" == "1" ]]; then
    echo "Smoke-test data kept at: $TMP_ROOT" >&2
  else
    rm -rf "$TMP_ROOT"
  fi
}
trap cleanup EXIT INT TERM

MOCK_CLI="$TMP_ROOT/mock-codex"
cat >"$MOCK_CLI" <<'EOF'
#!/usr/bin/env bash
set -euo pipefail
prompt="$(cat)"

if [[ "$prompt" == *"ORCHESTRATION_FINAL:"* ]]; then
  response='Final audit passed.
ORCHESTRATION_FINAL: {"decision":"complete","summary":"VPS orchestration validated","taskId":null,"feedback":"","tests":[{"command":"true","result":"exit 0","passed":true}]}'
elif [[ "$prompt" == *"ORCHESTRATION_REVIEW:"* ]]; then
  response='Worker patch reviewed.
ORCHESTRATION_REVIEW: {"decision":"accept","summary":"Patch and proof accepted","feedback":"","tests":[{"command":"true","result":"exit 0","passed":true}]}'
elif [[ "$prompt" == *"ORCHESTRATION_PROOF:"* ]]; then
  printf '%s\n' 'orchestrated on the VPS runtime' >vps-orchestration.txt
  response='Worker implementation completed.
ORCHESTRATION_PROOF: {"summary":"Created the VPS orchestration proof file","filesChanged":["vps-orchestration.txt"],"tests":[{"command":"test -f vps-orchestration.txt","result":"file exists","passed":true}],"risks":[]}'
elif [[ "$prompt" == *"ORCHESTRATION_PLAN:"* ]]; then
  response='Plan ready.
ORCHESTRATION_PLAN: {"summary":"One isolated VPS task","tasks":[{"title":"Runtime proof","description":"Create a deterministic proof file","acceptanceCriteria":["The proof file exists"]}]}'
elif [[ "$prompt" == *"AUTONOMOUS_STATUS:"* ]]; then
  response='Autonomous VPS cycle completed.
AUTONOMOUS_MEMORY_STRATEGY: retain reproducible runtime evidence
AUTONOMOUS_TASK: runtime-smoke | todo | runtime | repeat the VPS runtime check | first cycle passed
AUTONOMOUS_NEXT_TASK: runtime-smoke
AUTONOMOUS_STATUS: continue'
else
  response='Remote response produced by the VPS runtime.'
fi

printf '%s\n' \
  '{"type":"thread.started","thread_id":"11111111-1111-4111-8111-111111111111"}' \
  "$(jq -cn --arg text "$response" '{type:"item.completed",item:{id:"remote-answer",type:"agent_message",text:$text}}')" \
  '{"type":"turn.completed","usage":{"input_tokens":8,"output_tokens":7}}'
EOF
chmod 0700 "$MOCK_CLI"

cat >"$TMP_ROOT/codex-home/auth.json" <<'EOF'
{"tokens":{"access_token":"vps-smoke-token"}}
EOF

PORT="${CST_SMOKE_PORT:-18081}"
BASE_URL="http://127.0.0.1:$PORT"
ADMIN_TOKEN="cst-vps-smoke-admin-token"

CST_BIND="127.0.0.1:$PORT" \
CST_DATA_DIR="$TMP_ROOT/data" \
CST_WORKSPACES_ROOT="$WORKSPACES_ROOT" \
CST_STATIC_DIR="$STATIC_DIR" \
CST_PUBLIC_BASE_URL="$BASE_URL" \
CST_ADMIN_TOKEN="$ADMIN_TOKEN" \
CST_NODE_ID="vps-smoke" \
CST_NODE_LABEL="VPS SSH smoke" \
CST_NODE_CAPACITY="4" \
  "$SERVER_BINARY" >"$TMP_ROOT/server.log" 2>&1 &
SERVER_PID=$!

for _attempt in $(seq 1 80); do
  if curl -fsS --max-time 1 "$BASE_URL/healthz" >"$TMP_ROOT/healthz.json" 2>/dev/null; then
    break
  fi
  if ! kill -0 "$SERVER_PID" 2>/dev/null; then
    echo "Server stopped before becoming healthy:" >&2
    sed -n '1,200p' "$TMP_ROOT/server.log" >&2
    exit 1
  fi
  sleep 0.25
done

if ! jq -e '.ok == true and .ready == true and .nodeId == "vps-smoke"' \
  "$TMP_ROOT/healthz.json" >/dev/null; then
  echo "Invalid liveness response:" >&2
  cat "$TMP_ROOT/healthz.json" >&2
  exit 1
fi

UNAUTHORIZED_STATUS="$(curl -sS --max-time 2 -o "$TMP_ROOT/unauthorized.json" -w '%{http_code}' \
  "$BASE_URL/api/settings")"
if [[ "$UNAUTHORIZED_STATUS" != "401" ]]; then
  echo "Expected /api/settings without a token to return 401, got $UNAUTHORIZED_STATUS" >&2
  cat "$TMP_ROOT/unauthorized.json" >&2
  exit 1
fi

AUTH_HEADER="Authorization: Bearer $ADMIN_TOKEN"
curl -fsS --max-time 3 -H "$AUTH_HEADER" "$BASE_URL/api/health" \
  >"$TMP_ROOT/health.json"
jq -e '.ok == true and .nodeId == "vps-smoke" and .nodeLabel == "VPS SSH smoke"' \
  "$TMP_ROOT/health.json" >/dev/null

curl -fsS --max-time 3 -H "$AUTH_HEADER" "$BASE_URL/api/settings" \
  >"$TMP_ROOT/settings.json"
jq \
  --arg cli "$MOCK_CLI" \
  --arg home "$TMP_ROOT/codex-home" \
  '.codexCommand = $cli
   | .agents |= map(if .provider == "codex" then .command = $cli else . end)
   | .accounts = [{
       id: "vps-smoke-account",
       label: "VPS smoke account",
       provider: "codex",
       codexHome: $home,
       projectDir: null,
       proxyId: null,
       startupCommand: null,
       limits: {connectedAt: null, sessionAnchorAt: null, weeklyAnchorAt: null},
       bypass: false,
       model: null,
       reasoningEffort: null
     }]
   | .defaultAccountId = "vps-smoke-account"' \
  "$TMP_ROOT/settings.json" >"$TMP_ROOT/settings-configured.json"

curl -fsS --max-time 3 \
  -H "$AUTH_HEADER" \
  -H 'Content-Type: application/json' \
  --data-binary "@$TMP_ROOT/settings-configured.json" \
  -X PUT "$BASE_URL/api/settings" >"$TMP_ROOT/settings-saved.json"
jq -e --arg cli "$MOCK_CLI" \
  '.defaultAccountId == "vps-smoke-account"
   and .accounts[0].codexHome != null
   and .codexCommand == $cli' \
  "$TMP_ROOT/settings-saved.json" >/dev/null

run_chat_turn() {
  local mode="$1"
  local session_id="${2:-}"
  local suffix="$3"
  local request_file="$TMP_ROOT/start-turn-$suffix.json"
  local started_file="$TMP_ROOT/turn-started-$suffix.json"
  local final_file="$TMP_ROOT/turn-final-$suffix.json"
  local turn_id
  local turn_status=""

  jq -n \
    --arg mode "$mode" \
    --arg prompt "Valide le chemin de chat distant en mode $mode." \
    --arg sessionId "$session_id" \
    '{
      accountId: "vps-smoke-account",
      prompt: $prompt,
      mode: $mode,
      agentTools: [],
      agentSkills: [],
      questionTool: false,
      proofTool: false
    } + (if $sessionId == "" then {} else {sessionId: $sessionId} end)' \
    >"$request_file"

  curl -fsS --max-time 5 \
    -H "$AUTH_HEADER" \
    -H 'Content-Type: application/json' \
    --data-binary "@$request_file" \
    "$BASE_URL/api/chat/turns" >"$started_file"

  turn_id="$(jq -er '.id' "$started_file")"
  for _attempt in $(seq 1 80); do
    curl -fsS --max-time 2 -H "$AUTH_HEADER" \
      "$BASE_URL/api/chat/turns/$turn_id" >"$final_file"
    turn_status="$(jq -r '.status' "$final_file")"
    case "$turn_status" in
      completed) break ;;
      failed|cancelled)
        echo "Remote chat $suffix ended with status $turn_status:" >&2
        cat "$final_file" >&2
        exit 1
        ;;
    esac
    sleep 0.25
  done

  if [[ "$turn_status" != "completed" ]]; then
    echo "Remote chat $suffix did not complete before the timeout:" >&2
    cat "$final_file" >&2
    exit 1
  fi

  jq -e '
    .sessionId == "11111111-1111-4111-8111-111111111111"
    and .error == null
    and any(.parts[]; .kind == "text" and .text == "Remote response produced by the VPS runtime.")
  ' "$final_file" >/dev/null
  printf '%s' "$turn_id"
}

BUILD_TURN_ID="$(run_chat_turn build "" build)"
PLAN_TURN_ID="$(run_chat_turn plan "" plan)"
ASK_TURN_ID="$(run_chat_turn ask "" ask)"
RESUME_TURN_ID="$(run_chat_turn build "11111111-1111-4111-8111-111111111111" resume)"

curl -fsS --max-time 2 -H "$AUTH_HEADER" \
  "$BASE_URL/api/chat/turns/active" >"$TMP_ROOT/active-turns.json"
jq -e 'length == 0' "$TMP_ROOT/active-turns.json" >/dev/null

cat >"$TMP_ROOT/create-agent.json" <<'EOF'
{
  "name": "VPS autonomous smoke",
  "objective": "Valider un cycle autonome sur le runtime VPS.",
  "accountId": "vps-smoke-account",
  "mode": "ask",
  "requireUserReview": false,
  "connectors": [],
  "intervalSeconds": 60,
  "triggerKind": "schedule",
  "watchPaths": [],
  "debounceSeconds": 2,
  "allowGitPublish": false,
  "deferFirstRun": false
}
EOF

curl -fsS --max-time 5 \
  -H "$AUTH_HEADER" \
  -H 'Content-Type: application/json' \
  --data-binary "@$TMP_ROOT/create-agent.json" \
  "$BASE_URL/api/autonomous-agents" >"$TMP_ROOT/agent-created.json"
AGENT_ID="$(jq -er '.id' "$TMP_ROOT/agent-created.json")"

AGENT_RUN_COUNT="0"
for _attempt in $(seq 1 80); do
  curl -fsS --max-time 2 -H "$AUTH_HEADER" \
    "$BASE_URL/api/autonomous-agents" >"$TMP_ROOT/agents.json"
  if jq -e --arg id "$AGENT_ID" '
    any(.[]; .id == $id and .runCount >= 1 and .currentTurnId == null and .lastError == null)
  ' "$TMP_ROOT/agents.json" >/dev/null; then
    AGENT_RUN_COUNT="$(jq -r --arg id "$AGENT_ID" '.[] | select(.id == $id) | .runCount' "$TMP_ROOT/agents.json")"
    break
  fi
  sleep 0.25
done

if [[ "$AGENT_RUN_COUNT" -lt 1 ]]; then
  echo "Autonomous agent did not complete a remote cycle:" >&2
  cat "$TMP_ROOT/agents.json" >&2
  exit 1
fi

curl -fsS --max-time 3 \
  -H "$AUTH_HEADER" \
  -H 'Content-Type: application/json' \
  --data-binary '{"action":"pause"}' \
  "$BASE_URL/api/autonomous-agents/$AGENT_ID/control" >"$TMP_ROOT/agent-paused.json"
jq -e '.status == "paused" and .currentTurnId == null and .lastError == null' \
  "$TMP_ROOT/agent-paused.json" >/dev/null

jq -n \
  --arg projectDir "$SMOKE_REPO" \
  '{
    name: "VPS orchestration smoke",
    objective: "Validate the orchestrated chat runtime on Linux.",
    workerCount: 1,
    orchestratorAccountId: "vps-smoke-account",
    workerAccountIds: ["vps-smoke-account"],
    accountId: "vps-smoke-account",
    projectDir: $projectDir,
    testCommand: "true",
    testTimeoutSeconds: 30
  }' >"$TMP_ROOT/create-orchestration.json"

curl -fsS --max-time 5 \
  -H "$AUTH_HEADER" \
  -H 'Content-Type: application/json' \
  --data-binary "@$TMP_ROOT/create-orchestration.json" \
  "$BASE_URL/api/orchestrations" >"$TMP_ROOT/orchestration-created.json"
ORCHESTRATION_ID="$(jq -er '.id' "$TMP_ROOT/orchestration-created.json")"

ORCHESTRATION_STATUS=""
for _attempt in $(seq 1 240); do
  curl -fsS --max-time 2 -H "$AUTH_HEADER" \
    "$BASE_URL/api/orchestrations" >"$TMP_ROOT/orchestrations.json"
  ORCHESTRATION_STATUS="$(jq -r --arg id "$ORCHESTRATION_ID" \
    '.[] | select(.id == $id) | .status' "$TMP_ROOT/orchestrations.json")"
  case "$ORCHESTRATION_STATUS" in
    completed) break ;;
    needs_attention)
      echo "Orchestrated chat needs attention:" >&2
      jq --arg id "$ORCHESTRATION_ID" '.[] | select(.id == $id)' \
        "$TMP_ROOT/orchestrations.json" >&2
      exit 1
      ;;
  esac
  sleep 0.25
done

if [[ "$ORCHESTRATION_STATUS" != "completed" ]]; then
  echo "Orchestrated chat did not complete before the timeout:" >&2
  jq --arg id "$ORCHESTRATION_ID" '.[] | select(.id == $id)' \
    "$TMP_ROOT/orchestrations.json" >&2
  exit 1
fi

jq -e --arg id "$ORCHESTRATION_ID" '
  any(.[];
    .id == $id
    and .phase == "completed"
    and .publishApplied == true
    and .lastError == null
    and (.tasks | length) == 1
    and .tasks[0].status == "accepted")
' "$TMP_ROOT/orchestrations.json" >/dev/null
grep -qx 'orchestrated on the VPS runtime' "$SMOKE_REPO/vps-orchestration.txt"

jq -n \
  --arg binary "$SERVER_BINARY" \
  --arg node "vps-smoke" \
  --arg buildTurnId "$BUILD_TURN_ID" \
  --arg planTurnId "$PLAN_TURN_ID" \
  --arg askTurnId "$ASK_TURN_ID" \
  --arg resumeTurnId "$RESUME_TURN_ID" \
  --arg sessionId "11111111-1111-4111-8111-111111111111" \
  --arg agentId "$AGENT_ID" \
  --arg agentRunCount "$AGENT_RUN_COUNT" \
  --arg orchestrationId "$ORCHESTRATION_ID" \
  '{
    ok: true,
    binary: $binary,
    nodeId: $node,
    modes: {
      build: ($buildTurnId | tonumber),
      plan: ($planTurnId | tonumber),
      ask: ($askTurnId | tonumber)
    },
    resumedTurnId: ($resumeTurnId | tonumber),
    sessionId: $sessionId,
    chatStatus: "completed",
    autonomousAgentId: $agentId,
    autonomousRunCount: ($agentRunCount | tonumber),
    autonomousStatus: "paused",
    orchestrationId: $orchestrationId,
    orchestrationStatus: "completed"
  }'
