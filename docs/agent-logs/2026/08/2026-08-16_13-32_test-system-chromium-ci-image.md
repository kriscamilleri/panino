# Evaluate CI test browser alternatives

Agent: Copilot CLI runtime in VS Code
Start: 2026-08-16T13:32:14+02:00
Status: Validated - Awaiting Review

## Objective

Determine whether replacing Puppeteer's downloaded browser with a lighter compatible option
speeds up the backend test Docker image build.

## Progress

The baseline test image is 1,590,063,764 bytes. Its Puppeteer browser cache is 651 MB. The
experiment installed Debian's `chromium`, set `PUPPETEER_SKIP_DOWNLOAD=true`, and set
`PUPPETEER_EXECUTABLE_PATH=/usr/bin/chromium` in `Dockerfile.test`.

The experiment image was smaller at 1,445,365,874 bytes, but a no-cache local build took
1:05.39. Debian Chromium installation alone took 58 seconds, making it unsuitable against the
62-second GitHub Actions backend-job baseline.

## Changes Made

- No application or Dockerfile change retained. The experiment was reverted after measurement.

## Tests

- Built the experimental image without cache; Chromium 151 launched successfully.
- Ran the complete backend suite in the experiment image: 15 files and 170 tests passed.
- Test-container wall time: 30.36 seconds.

## Open Items / Notes

- Image-size reduction alone is not a useful CI speed metric on fresh GitHub-hosted runners.
- A future image optimization should be accepted only after a GitHub Actions run beats the
  62-second backend-job baseline.

## Headless Shell Experiment

- Puppeteer 25 currently downloads both full Chrome (291 MB binary) and Chrome Headless Shell
  (197 MB binary). The test Dockerfile now skips only full Chrome with
  `PUPPETEER_CHROME_SKIP_DOWNLOAD=true`, retaining the Puppeteer-matched Headless Shell used by
  headless PDF generation.
- Puppeteer's default `headless: true` launch resolution still requested full Chrome. The
  experiment therefore creates a stable symlink to the downloaded Headless Shell and configures
  it through `PUPPETEER_EXECUTABLE_PATH`; this is scoped to the test image.
- A clean local image build completed in 1:07.68, but a preceding equivalent clean build completed
  in 56.27 seconds, so local Docker timing is too variable to establish a result. The experiment
  image is 1,183,288,391 bytes, 406,775,373 bytes smaller than baseline.
- All 15 backend test files and 170 tests passed with the explicit Headless Shell executable path.
  A GitHub-hosted run is required before accepting the change.
- GitHub Actions PR run `31945040175` passed all lint, frontend, and backend checks. The backend
  job took 60 seconds, and its Docker build-plus-test step took 56 seconds, improving on the
  62-second backend-job baseline.
