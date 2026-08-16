# Promote vendored CR-SQLite runtime

- Agent: Copilot CLI
- Started: 2026-08-16 17:50 +02:00
- Status: Complete

## Objective

Promote the tested vendored CR-SQLite runtime and npm-standardized frontend from `develop` to
`main`, then verify that the public site and production API container use the committed
runtime binaries.

## Progress

- Created a timestamped production database backup before deployment.
- Added approved document-terminology coverage and corrected the terminology assertion that had
  blocked the frontend CI job.
- Waited for the `develop` CI workflow to pass before promoting the exact same commit to `main`.
- Waited for the `main` test-and-deploy workflow to complete successfully.

## Changes Made

- Promoted commit `07f3603` to both `develop` and `main`.
- No direct production file mutation was performed; the GitHub deployment workflow rebuilt and
  restarted the service through the repository deployment script.

## Tests

- Backup: `/home/kris/backups/panino/panino-databases-20260816T155119Z.tar.gz`
  - SHA-256 verification passed.
  - Archive contains 13 databases.
- Clean Node 24.19.0 frontend test run: 20 files, 355 tests passed.
- `npm run lint`: zero errors (40 existing warnings).
- GitHub Actions workflow `31956942795` for `develop`: lint, frontend, and backend jobs passed.
- GitHub Actions deployment workflow `31957016224` for `main`: test and deploy jobs passed.
- Public `https://panino.sh` served CR-SQLite WASM SHA-256:
  `1c83c806b17e17ea8b459784f427761e8c7ff4d1e85f36a69c0d448225ed8c13`,
  matching the committed frontend asset.
- Production checkout and running `panino-api-service-1` native extension SHA-256:
  `4052ae711d5155f8ef876794b1bc0e0eb366a7e598371b86329a78576b8f8a52`,
  matching the committed backend extension.

## Open Items / Notes

- The production compose command reports that its top-level `version` attribute is obsolete;
  this is a non-blocking existing warning and was not changed during the release.
