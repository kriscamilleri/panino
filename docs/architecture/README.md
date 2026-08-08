# Architecture reference

These documents describe how Panino currently works. They are mechanism-level references,
not proposals or work logs.

| Directory | Answers | Tense |
|---|---|---|
| `docs/architecture/` | How does it work? | Present |
| `docs/specs/` | What should we build? | Future |
| `docs/agent-logs/` | What happened, and how do we know? | Past |
| `docs/runbooks/` | What do I do when X? | Imperative |

## Contents

- [CR-SQLite sync](crsqlite-sync.md) — merge protocol, clocks, tombstones, and failure modes
- [Data model](data-model.md) — schemas and the `/sync` wire contract
- [Auth and JWT](auth-and-jwt.md) — current authentication boundary and handshake pointer
- [PDF pipeline](pdf-pipeline.md) — current rendering and SSRF-protection pointer

## How this directory gets updated

When an investigation establishes something durable about how the system behaves, promote it
here in the same change that writes the log. The log keeps the narrative and the evidence;
this directory keeps the conclusion. If you find yourself re-deriving something an old log
already established, that is the signal it should be promoted — promote it then.
