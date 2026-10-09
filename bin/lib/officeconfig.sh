# Sourced by the bash scripts in bin/ after officeroot.sh (twin of officeconfig.py): repo names and GitHub slugs from
# office.json ($BUSYBODY_CONFIG, else $OFFICE_CONFIG, else $WORKSPACE_ROOT/office.json). There are no built-in defaults: a missing
# minutesRepo is an error (one line on stderr, rc 1). `repos` must be an object; anything else is ignored.
OFFICE_CONFIG_FILE="$(bb_env CONFIG)"; OFFICE_CONFIG_FILE="${OFFICE_CONFIG_FILE:-$WORKSPACE_ROOT/office.json}"
_office_get() { # $1 = jq filter, $2 = optional repo name as $r; empty when the file, jq or the key is missing
  [[ -f "$OFFICE_CONFIG_FILE" ]] && command -v jq >/dev/null && jq -r --arg r "${2:-}" "$1 // empty" "$OFFICE_CONFIG_FILE" 2>/dev/null || true
}
office_minutes_repo() { # fails loudly: one line on stderr, rc 1
  local v
  command -v jq >/dev/null || { echo "jq is not installed" >&2; return 1; }
  v="$(_office_get .minutesRepo)"
  [[ -n "$v" ]] || { echo 'no minutesRepo: run `busybody init`' >&2; return 1; }
  echo "$v"
}
office_workspace_repo() { local v; v="$(_office_get .workspaceRepo)"; echo "${v:-$(basename "$WORKSPACE_ROOT")}"; }   # else the workspace folder's name
office_github() { # $1 = repo name -> owner/name; the workspace repo is the minutes repo
  local r="$1" v owner
  if [[ "$r" == "$(office_workspace_repo)" ]]; then office_minutes_repo; return; fi
  v="$(_office_get 'if (.repos | type) == "object" and ((.repos[$r] | type) == "object") then .repos[$r].github else empty end' "$r")"
  if [[ -n "$v" ]]; then echo "$v"; return; fi
  owner="$(office_minutes_repo)" || return 1; echo "${owner%%/*}/$r"
}
office_evidence() { # $1 = repo name -> the evidence executable's name under evidence/, "default" (PR merged) when the repo names none, empty when the repo is not in the config
  _office_get 'if (.repos | type) == "object" and (.repos | has($r)) then ((.repos[$r] | if type == "object" then .evidence else null end) // "default") else empty end' "$1"
}
# The per-repo and room fields go through officeconfig.py, so validation lives in one place (a bad or missing field prints
# one line on stderr and returns 1). Output of noPush, office_owner_only and office_repos is one item per line.
_office_py() { python3 -I "$(dirname "${BASH_SOURCE[0]}")/officeconfig.py" --config "$OFFICE_CONFIG_FILE" --workspace "$WORKSPACE_ROOT" "$@"; }
office_branch_prefix() { _office_py get "$1" branchPrefix; }   # "" is a valid prefix
office_no_push() { _office_py get "$1" noPush; }               # `main` is always first
office_merge() { _office_py get "$1" merge; }                  # pr | land
office_done_note() { _office_py get "$1" doneNote; }
office_room_json() { _office_py room-json; }                   # {env, deny, prodRead, portBase}
office_port_base() { office_room_json | jq -r .portBase; }
office_owner_only() { _office_py owner-only; }
office_repos() { _office_py repos; }
