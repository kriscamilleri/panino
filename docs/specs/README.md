# Specs

| Directory | Meaning |
|---|---|
| `proposed/` | Designed, not started. Do not assume any of it exists |
| `active/` | Being implemented; check the header for the remaining delta |
| `shipped/` | Live in production; `Implementation:` maps intent to code |
| `dx/` | Developer-experience specs about this repository, not the product |

DX specs follow the same lifecycle as product specs and move into `shipped/` when done —
they keep their `dx-NN-` prefix so the set stays recognisable. `dx/` holds the ones still
open. A DX spec that is **declined** rather than implemented stays in `dx/` with the decision
recorded in its header and a `DECIDED` block in the body; declining is a conclusion, not a
shipment.

A spec describes what we intend to build. For how the system currently works, read
[`docs/architecture/`](../architecture/). For what an agent did, read
[`docs/agent-logs/`](../agent-logs/).

## Lifecycle

`proposed/` → `active/` when implementation starts → `shipped/` when it is live.

Move the file with `git mv` and update its header in the same commit. Shipped specs must
include `Shipped:` and `Implementation:` lines. The visible path is the authoritative status;
the header records provenance and code locations.
