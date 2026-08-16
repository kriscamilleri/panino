#!/usr/bin/env bash
# DX-10 §6 Phase 2 step 8 — two-arm merge-behaviour verification.
#
# Runs the same fixed sequence of CR-SQLite operations against two copies of the same
# database: one on better-sqlite3 9.6.0 (SQLite 3.45.3, current production) and one on
# 12.11.1 (SQLite 3.53.2, the Phase 2 target). Then diffs the reports.
#
# The spec's step 8 asks to "compare crsql_db_version() and the clock-table row counts before
# and after; they must move consistently with the same operations on a 9.6.0 build". A single
# run against a snapshot cannot answer that — it has no baseline. This does.
#
# Both arms hold Node at 20 so the only variable is the dependency, per DX-10 §5.1.
#
# The input database is never modified: each arm works on its own copy.
set -Eeuo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"

OLD_VERSION="${DX10_OLD_BETTER_SQLITE3:-9.6.0}"
NEW_VERSION="${DX10_NEW_BETTER_SQLITE3:-12.11.1}"
WORK_DIR="${DX10_WORK_DIR:-}"
INPUT_DB=""
SYNTHETIC_NOTES=""

usage() {
  cat <<'EOF'
Usage: run-two-arm-verification.sh [--database PATH] [--synthetic [N]] [--work-dir PATH]

  --database PATH   Verify against an existing database file (a copy is used; never mutated)
  --synthetic [N]   Generate a fixture on the OLD arm first, with N notes (default 400)
  --work-dir PATH   Where to place copies and reports (default: a mktemp directory)

Exactly one of --database or --synthetic is required.

--synthetic generates the fixture on the 9.6.0 arm deliberately: the risk being tested is
CR-SQLite state written by SQLite 3.45.3 and read by 3.53.2, so a fixture written by the new
stack would prove nothing.
EOF
}

while (($# > 0)); do
  case "$1" in
    --database)
      [[ $# -ge 2 ]] || { echo "Missing value for --database" >&2; exit 2; }
      INPUT_DB="$2"; shift 2 ;;
    --synthetic)
      if [[ $# -ge 2 && "$2" =~ ^[0-9]+$ ]]; then SYNTHETIC_NOTES="$2"; shift 2
      else SYNTHETIC_NOTES=400; shift 1; fi ;;
    --work-dir)
      [[ $# -ge 2 ]] || { echo "Missing value for --work-dir" >&2; exit 2; }
      WORK_DIR="$2"; shift 2 ;;
    -h|--help) usage; exit 0 ;;
    *) echo "Unknown option: $1" >&2; usage >&2; exit 2 ;;
  esac
done

if [[ -n "$INPUT_DB" && -n "$SYNTHETIC_NOTES" ]]; then
  echo "Use either --database or --synthetic, not both" >&2; exit 2
fi
if [[ -z "$INPUT_DB" && -z "$SYNTHETIC_NOTES" ]]; then
  echo "One of --database or --synthetic is required" >&2; usage >&2; exit 2
fi
if [[ -n "$INPUT_DB" && ! -r "$INPUT_DB" ]]; then
  echo "Database not readable: $INPUT_DB" >&2; exit 1
fi

if [[ -z "$WORK_DIR" ]]; then
  WORK_DIR="$(mktemp -d -t dx10-merge-verification-XXXXXX)"
fi
mkdir -p -- "$WORK_DIR"

build_arm() {
  local version="$1" tag="$2"
  echo "[dx10] building arm better-sqlite3@$version ..." >&2
  # patch-crsqlite.sh is copied out of the backend so the arms patch CR-SQLite exactly the
  # way the real images do, rather than carrying a second copy of that logic.
  cp "$REPO_ROOT/backend/api-service/patch-crsqlite.sh" "$SCRIPT_DIR/patch-crsqlite.sh"
  docker build -q \
    --build-arg "BETTER_SQLITE3_VERSION=$version" \
    -f "$SCRIPT_DIR/Dockerfile.arm" \
    -t "$tag" "$SCRIPT_DIR" >/dev/null
  rm -f "$SCRIPT_DIR/patch-crsqlite.sh"
}

OLD_TAG="panino-dx10-arm-old"
NEW_TAG="panino-dx10-arm-new"
build_arm "$OLD_VERSION" "$OLD_TAG"
build_arm "$NEW_VERSION" "$NEW_TAG"

if [[ -n "$SYNTHETIC_NOTES" ]]; then
  echo "[dx10] generating synthetic fixture on the OLD arm ($OLD_VERSION) ..." >&2
  docker run --rm -v "$WORK_DIR:/work" "$OLD_TAG" \
    /probe/make-synthetic-fixture.mjs /work/fixture.db --notes "$SYNTHETIC_NOTES" \
    | tee "$WORK_DIR/fixture-summary.json"
  INPUT_DB="$WORK_DIR/fixture.db"
fi

# Each arm gets its own copy so neither can observe the other's mutations, and so the input
# is left untouched.
cp -- "$INPUT_DB" "$WORK_DIR/arm-old.db"
cp -- "$INPUT_DB" "$WORK_DIR/arm-new.db"

run_arm() {
  local tag="$1" db="$2" out="$3" log="$4"
  echo "[dx10] probing $tag ..." >&2
  # The probe exits non-zero when a merge fails. That is a result, not a script error — it is
  # recorded in the report and compared — so do not let set -e abort the other arm. stderr is
  # captured rather than discarded: a probe that crashes hard (SIGILL from the extension, say)
  # writes nothing to stdout, and swallowing that would leave an empty report.
  docker run --rm -v "$WORK_DIR:/work" "$tag" \
    /probe/merge-behaviour-probe.mjs "/work/$db" \
    > "$WORK_DIR/$out" 2> "$WORK_DIR/$log" || true

  # An empty or unparseable report is a harness failure, never a passing comparison. Two
  # empty files diff clean, which would report IDENTICAL for two arms that both crashed.
  if ! python3 -c "import json,sys; json.load(open(sys.argv[1]))" "$WORK_DIR/$out" 2>/dev/null; then
    echo "[dx10] FATAL: $tag produced no usable report ($out)." >&2
    echo "[dx10] probe stderr:" >&2
    sed 's/^/    /' "$WORK_DIR/$log" >&2 || true
    exit 3
  fi
}

run_arm "$OLD_TAG" "arm-old.db" "report-old.json" "probe-old.stderr"
run_arm "$NEW_TAG" "arm-new.db" "report-new.json" "probe-new.stderr"

echo
echo "=== old arm (better-sqlite3 $OLD_VERSION) ==="
cat "$WORK_DIR/report-old.json"
echo
echo "=== new arm (better-sqlite3 $NEW_VERSION) ==="
cat "$WORK_DIR/report-new.json"

echo
echo "=== verdict (sqliteVersion and betterSqlite3Version are expected to differ) ==="

# Comparing the two reports is only the second question. The first is whether either arm
# actually performed the work: two arms that fail in the same way also produce identical
# reports, and calling that "merge behaviour is unchanged" would be exactly backwards. So a
# clean comparison is only reported as a pass when both arms completed every step with no
# recorded error.
set +e
python3 - "$WORK_DIR/report-old.json" "$WORK_DIR/report-new.json" <<'PY'
import json, sys

EXPECTED_STEPS = [
    "pull-changes-since-0",
    "merge-insert-note",
    "merge-update-note",
    "local-edit",
    "image-insert",
    "note-delete",
    "image-delete",
]

def load(path):
    with open(path) as handle:
        return json.load(handle)

old, new = load(sys.argv[1]), load(sys.argv[2])

inconclusive = []
for name, report in (("old", old), ("new", new)):
    if report.get("errors"):
        messages = "; ".join(e.get("message", "?") for e in report["errors"])
        inconclusive.append(f"{name} arm recorded an error: {messages}")
    done = [step.get("step") for step in report.get("steps", [])]
    missing = [step for step in EXPECTED_STEPS if step not in done]
    if missing:
        inconclusive.append(f"{name} arm did not complete: {', '.join(missing)}")

if inconclusive:
    print("INCONCLUSIVE — the comparison proves nothing because an arm did not finish:")
    for line in inconclusive:
        print(f"  - {line}")
    print("\nFix the probe or the input database and re-run. Do not read this as a pass.")
    sys.exit(4)

def comparable(report):
    trimmed = dict(report)
    trimmed.pop("sqliteVersion", None)
    trimmed.pop("betterSqlite3Version", None)
    return json.dumps(trimmed, indent=2, sort_keys=True).splitlines()

import difflib
diff = list(difflib.unified_diff(comparable(old), comparable(new),
                                 fromfile="old-arm", tofile="new-arm", lineterm=""))

print(f"old arm: better-sqlite3 {old['betterSqlite3Version']} / SQLite {old['sqliteVersion']}")
print(f"new arm: better-sqlite3 {new['betterSqlite3Version']} / SQLite {new['sqliteVersion']}")
print(f"both arms completed all {len(EXPECTED_STEPS)} steps with no errors.")
print()

if not diff:
    print("IDENTICAL — CR-SQLite merge behaviour is unchanged across the SQLite versions.")
    sys.exit(0)

print("\n".join(diff))
print()
print("DIFFERENT — investigate before deploying Phase 2. This is what step 8 exists to catch.")
sys.exit(1)
PY
verdict=$?
set -e

echo
echo "Reports and copies are in: $WORK_DIR"
exit "$verdict"
