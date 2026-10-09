# Sourced by the bash scripts in bin/ (twin of officeroot.py). The caller sets ENGINE_ROOT first:
#   ENGINE_ROOT="$(cd "$(dirname "$0")/.." && pwd)"; . "$ENGINE_ROOT/bin/lib/officeroot.sh"
# Sets WORKSPACE_ROOT: $BUSYBODY_WORKSPACE (the old $OFFICE_WORKSPACE still works), else the nearest parent of the cwd holding office.json, else the folder above $0's directory when it holds office.json (a
# compat symlink into the engine), else ENGINE_ROOT.
bb_env() { # $1 = key, e.g. WORKSPACE: $BUSYBODY_<key>, else $OFFICE_<key>, else the other names given; empty when none is set
  local k="$1" v n; shift
  for n in "BUSYBODY_$k" "OFFICE_$k" "$@"; do v="${!n:-}"; [[ -z "$v" ]] || { printf '%s' "$v"; return; }; done
}
_ws="$(bb_env WORKSPACE)"
if [[ -n "$_ws" ]]; then
  WORKSPACE_ROOT="$(cd "$_ws" 2>/dev/null && pwd || echo "$_ws")"
else
  WORKSPACE_ROOT="$ENGINE_ROOT"
  _d="$PWD"
  while :; do
    [[ -f "$_d/office.json" ]] && { WORKSPACE_ROOT="$_d"; break; }
    if [[ "$_d" == / ]]; then
      # launched through a symlink from a workspace (its bin/<tool>), from a folder outside it: that workspace
      _inv="$(cd "$(dirname "$0")/.." 2>/dev/null && pwd)"
      [[ -n "$_inv" && -f "$_inv/office.json" ]] && WORKSPACE_ROOT="$_inv"
      break
    fi
    _d="$(dirname "$_d")"
  done
  unset _d _inv
fi
unset _ws
# DATA_ROOT: where clones and .cache/ live. The workspace itself, except a worktree of the workspace repo with no clones of its own,
# which uses the main checkout's (when that holds office.json). An explicit $BUSYBODY_WORKSPACE is used as given.
DATA_ROOT="$WORKSPACE_ROOT"
if [[ -z "$(bb_env WORKSPACE)" && -f "$WORKSPACE_ROOT/.git" ]] && ! compgen -G "$WORKSPACE_ROOT/*/.git" >/dev/null; then
  _c="$(git -C "$WORKSPACE_ROOT" rev-parse --path-format=absolute --git-common-dir 2>/dev/null || true)"
  [[ "$(basename "${_c:-x}")" == .git && -f "$(dirname "$_c")/office.json" ]] && DATA_ROOT="$(dirname "$_c")"
  unset _c
fi
