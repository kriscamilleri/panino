---
name: production-database-backup
description: "Use when the user asks to run, verify, or troubleshoot the Panino production database streaming backup."
---

# Production Database Backup

Require explicit approval in the current conversation before connecting to production. Never
print values from `prd-server.env`.

Run from the repository root:

```bash
./scripts/production-database-backup/backup-production-databases.sh
```

After success, verify the exact archive reported by the command:

```bash
cd ~/backups/panino
sha256sum -c <archive>.sha256
tar -tzf <archive> | awk '/^[^/]+\.db$/ { count++ } END { print count + 0 }'
```

Report the archive path, database count, checksum result, and any failure. Do not extract over
production data. See `scripts/production-database-backup/README.md` for details.
