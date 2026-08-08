# Specs

| Directory | Meaning |
|---|---|
| `proposed/` | Designed, not started. Do not assume any of it exists |
| `active/` | Being implemented; check the header for the remaining delta |
| `shipped/` | Live in production; `Implementation:` maps intent to code |
| `dx/` | Developer-experience specs about this repository, not the product |

A spec describes what we intend to build. For how the system currently works, read
[`docs/architecture/`](../architecture/). For what an agent did, read
[`docs/agent-logs/`](../agent-logs/).

## Lifecycle

`proposed/` → `active/` when implementation starts → `shipped/` when it is live.

Move the file with `git mv` and update its header in the same commit. Shipped specs must
include `Shipped:` and `Implementation:` lines. The visible path is the authoritative status;
the header records provenance and code locations.
