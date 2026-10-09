# Sourced by evidence/<repo> executables (the contract is in docs/office-engine-split.md, "Deploy evidence").
# Environment from bin/status: BUSYBODY_REPO_DIR (the clone), BUSYBODY_GITHUB (owner/name), BUSYBODY_HEAD_SHA, BUSYBODY_PR_FILES.
# The old OFFICE_* names are exported too and are read here when the BUSYBODY_* one is unset.
BUSYBODY_REPO_DIR="${BUSYBODY_REPO_DIR:-${OFFICE_REPO_DIR:-}}"
BUSYBODY_GITHUB="${BUSYBODY_GITHUB:-${OFFICE_GITHUB:-}}"
BUSYBODY_HEAD_SHA="${BUSYBODY_HEAD_SHA:-${OFFICE_HEAD_SHA:-}}"
BUSYBODY_PR_FILES="${BUSYBODY_PR_FILES:-${OFFICE_PR_FILES:-}}"

# is_ancestor <sha> <descendant-sha>
is_ancestor() { git -C "$BUSYBODY_REPO_DIR" merge-base --is-ancestor "$1" "$2" 2>/dev/null; }

# Latest successful run of a workflow on a branch -> its head sha (empty if none)
last_success_sha() { # $1 workflow  $2 branch
  gh run list -R "$BUSYBODY_GITHUB" --workflow "$1" --branch "$2" --status success -L 1 \
    --json headSha -q '.[0].headSha // empty' 2>/dev/null
}

# verdicts: line 1 is "<VERDICT> <reason>"; WAIT may add a second line "has: <what is already proven>"
pass() { printf 'PASS %s\n' "${*:-no reason given}"; exit 0; }
wait_for() { printf 'WAIT %s\n' "${1:-no reason given}"; [[ -z "${2:-}" ]] || printf 'has: %s\n' "$2"; exit 1; }
fail() { printf 'FAIL %s\n' "${*:-no reason given}"; exit 2; }
