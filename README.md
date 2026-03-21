# Panino ~ Pretty Neat Notes

A browser based, local-first markdown note-taking Progressive Web App (PWA) with optional cloud sync.

## User Guide

### Features
- 🌐 **Progressive Web App** - Install on any device, works offline
- 💾 Local SQLite storage via WebAssembly
- 🔄 Optional multi-device sync using CR-SQLite
- ✍️ Markdown editing with live preview
- 🎨 Custom styling for preview and print
- 🖼️ Image uploads and management
- 📦 Import/export in multiple formats
- ☁️ GitHub backup with per-user repository connection
- 🔍 Full-text search
- 📁 Files and folders 
- 📱 Responsive web interface
- 🧩 Front‑matter metadata variables for preview & PDF

### Print

Open `Tools -> Print` with a document selected to move from editing into print preparation. Panino generates a live PDF preview and gives you a separate print-focused style editor, so you can tune the exported layout without changing the on-screen reading experience.

Print customization includes:
- Typography and element-level styling for headings, text, lists, links, tables, code blocks, and images.
- Header and footer controls, including alignment, font size, color, and custom HTML.
- Page layout settings such as page numbers, side margins, header/footer height, and custom print CSS.
- A live PDF preview so you can iterate on the final output before printing or saving.

### Import

Open `Tools -> Import` to bring existing notes and document data into Panino. The import dialog is designed for both quick migrations and raw data recovery, so you can either drop in a file or paste content directly.

Import supports:
- Drag-and-drop JSON uploads.
- Manual file selection from disk.
- Pasting JSON directly into the dialog.
- StackEdit-formatted JSON when you enable the StackEdit import option.

This makes it practical both to restore a previous export and to migrate content from StackEdit-style backups.

### Export

Open `Tools -> Export` to download your workspace in the format that fits your goal. Exports are intended for backup, migration, sharing with other tools, or keeping a markdown copy of your notes outside the app.

Each export includes your note structure and supporting data in a different shape:

- `Panino JSON` for a full Panino backup or migration.
- `StackEdit JSON` for compatibility with StackEdit.
- `Markdown ZIP` for notes as `.md` files in their folder structure, including exported images and metadata.

Panino exports more than note bodies alone. Depending on the format, exports can also include folders, images, settings, and variables so the result is useful for restoring or moving a full workspace.

### Backup

Open `Tools -> Backup` to push a full snapshot of your notes, folders, and images to GitHub. The backup flow is built around a one-time GitHub connection, after which you can select an existing repository or create a new private repository directly from the modal.

The backup workflow includes:
- Connecting or disconnecting your GitHub account.
- Choosing an existing repository with push access.
- Creating a new private repository for backups.
- Running a manual backup immediately.
- Viewing backup status details such as the selected repository, next scheduled backup time, last backup time, last commit SHA, warnings, and errors.

Automatic backups are checked after sync activity rather than by a standalone cron job. Once GitHub is connected and a repository is selected, Panino can perform a daily backup when the last one is older than 24 hours.

### Images

Open `Tools -> Images` to manage the image library attached to your account. This view is useful when you want to understand storage usage, clean up unused assets, or inspect what images are already available for notes.

The image manager provides:
- Thumbnail previews alongside filename, MIME type, size, created date, and usage count.
- Search by filename.
- Sorting by newest, oldest, largest, or smallest.
- Pagination controls for browsing larger libraries.
- Single-image deletion and bulk deletion for selected items.

Because image management is backed by the server-side image library, this tool is intended for connected use rather than purely offline editing.

### Revisions

Open `Tools -> Revisions` with a document selected to inspect that note's saved history over time. Panino shows a list of stored revisions and lets you compare an older revision against the note's current content before deciding what to keep.

Revision history is designed for:
- Reviewing older saved states of the current note.
- Comparing past content against the latest version with a line-based diff view.
- Saving a manual version when you want to preserve a milestone explicitly.
- Restoring a selected revision back into the current note.
- Loading older revisions when the note has a longer history than the first page shows.

This makes revision history useful both for recovery and for intentional versioning during larger edits.

Panino keeps dense short-term history and gradually thins older automatic snapshots:
- Revisions from the most recent 48 hours are kept in full.
- After 48 hours, automatic revisions are pruned down to at most one retained revision per calendar day.
- Manual saved versions are not thinned by the daily pruning rule.
- An overall cap of 200 revisions per note still applies, so very old revisions can be removed once that limit is exceeded.

### Variables

Open `Tools -> Variables` to manage global placeholders that can be reused across your documents. These are useful for values you want to define once and reference repeatedly, such as organization names, addresses, authors, or recurring labels.

Variables support:
- Adding named values that become available across the workspace.
- Editing or deleting existing entries from a single list.
- Reusing the same placeholder in multiple notes.
- Overriding a global value inside a specific document by defining the same key in front matter.

This allows you to combine workspace-wide defaults with per-document customization.

Panino also supports document-level variables defined in a YAML-style front-matter block at the very top of a note. The block is not rendered in the preview or PDF, and you can reference any variable in the document using `{{ Variable Name }}`.

Example:

```markdown
---
layout: post
title: Hit by a Bus
subtitle: The artful management metaphor
author: Kris Camilleri
tags: ['Communication', 'Best practices', 'Artful Management Metaphors']
timeToRead: 5'30"
---

# {{ title }}

By {{ author }}

Reading time: {{ timeToRead }}
```

Global placeholders:
- `{{ GLOBAL_DATE }}`
- `{{ GLOBAL_TIME }}`

## Developer Guide

### Quick Start

### Prerequisites
- Docker & Docker Compose

### Production
```bash
docker compose up -d
```

### Development
```bash
docker compose -f docker-compose.dev.yml up --build
```

For faster frontend development, you can run the frontend locally:
```bash
cd frontend
npm install
npm run dev
```


#### Environment Variables

You need to create two environment files to run the application.

#### 1. Root (`/.env`)

This file should be placed in the root directory of the project. It configures the backend services, deployment scripts, and email settings.

```ini
# A long, random, secure string for signing authentication tokens.
JWT_SECRET=generate_a_strong_random_secret
# Cloudflare Turnstile credentials for CAPTCHA. Get these from your Cloudflare dashboard.
# Used for server-side verification.
TURNSTILE_SECRET_KEY=0x4...SECRET...VI
# Used by the Nginx setup script to create the frontend .env file.
TURNSTILE_SITE_KEY=0x4...SITEKEY...f0
# The public URL of your frontend (e.g., [https://notes.example.com](https://notes.example.com))
FRONTEND_URL="[https://panino.sh](https://panino.sh)"
# The public URL of the API after proxying. This is used to generate the OAuth callback URL.
PUBLIC_API_BASE_URL="https://panino.sh/api"
# Domain name used by the Nginx setup script (e.g., notes.example.com)
DOMAIN="panino.sh"
# Your email address for Let's Encrypt SSL certificate registration.
EMAIL="your-email@example.com"
# --- GitHub OAuth (for GitHub Backup) ---
# One GitHub OAuth app per deployment. For panino.sh, the callback URL should be:
# https://panino.sh/api/backup/github/callback
GITHUB_CLIENT_ID=Iv1.yourgithubclientid
GITHUB_CLIENT_SECRET=your_github_oauth_client_secret
# --- SMTP Server Settings (for password resets) ---
# Hostname of your SMTP server.
SMTP_HOST=smtp.mailgun.org
# Port of your SMTP server (e.g., 587 for TLS, 465 for SSL).
SMTP_PORT=587
# Username for your SMTP server.
SMTP_USER=postmaster@yourdomain.com
# Password or API key for your SMTP server.
SMTP_PASS=your_smtp_password
# The "From" address for emails sent by the application.
SMTP_FROM="Panino <noreply@panino.sh>"
# (Optional) Set to true to skip Let's Encrypt setup and handle SSL manually.
SKIP_SSL=false
```
### 2. Frontend (`/frontend/.env`)

This file is used to build the frontend application. The deployment script (deploy.sh) can generate a production version of this for you, but you may need to create it manually for development.

```ini
# The public URL where the backend API is accessible. In production, this is
# usually the same as your main domain.
VITE_API_SERVICE_URL="[https://panino.sh](https://panino.sh)"
# Your public site key from the Cloudflare Turnstile dashboard.
VITE_TURNSTILE_SITE_KEY=0x4...SITEKEY...f0
```

> #### Where to Get Keys
> - JWT_SECRET: You should generate this yourself. A good method is to run openssl rand -hex 32 in your terminal.
> - TURNSTILE_SECRET_KEY & TURNSTILE_SITE_KEY: These are obtained for free from the Cloudflare Turnstile dashboard after you add your site.
> - GITHUB_CLIENT_ID & GITHUB_CLIENT_SECRET: Create a GitHub OAuth App in GitHub Developer Settings. For the deployed Panino instance at `panino.sh`, use homepage URL `https://panino.sh` and authorization callback URL `https://panino.sh/api/backup/github/callback`.
> - SMTP_*: These settings are provided by your email service (e.g., Mailgun, SendGrid, Amazon SES, or your personal email provider).

### GitHub Backup OAuth Setup

Panino's GitHub Backup feature uses a standard GitHub OAuth App.

### How automatic backups run

Automatic GitHub backups are not scheduled with a cron job or a standalone background timer. Instead, they are checked opportunistically after a successful sync for that user.

- Panino checks backup eligibility after sync activity.
- A backup only runs when GitHub is connected, a repository is selected, automatic backups are enabled, and the previous backup is more than 24 hours old.
- Manual backups use the same backup pipeline, but start immediately from `Tools -> Backup`.

This means automatic backups are effectively "once per day while the user is active and syncing," not "once per day regardless of activity."

### Production (`panino.sh`)

Create a GitHub OAuth App with:

- Application name: `Panino`
- Homepage URL: `https://panino.sh`
- Authorization callback URL: `https://panino.sh/api/backup/github/callback`

Set these values in the root `.env` used by production:

```ini
FRONTEND_URL="https://panino.sh"
PUBLIC_API_BASE_URL="https://panino.sh/api"
GITHUB_CLIENT_ID=Iv1.yourgithubclientid
GITHUB_CLIENT_SECRET=your_github_oauth_client_secret
```

Then restart the backend container:

```bash
docker compose up --build -d api-service
```

### Local development

Use a separate GitHub OAuth App for local testing:

- Homepage URL: `http://localhost:5173`
- Authorization callback URL: `http://localhost:8000/backup/github/callback`

Example local `.env` additions:

```ini
FRONTEND_URL="http://localhost:5173"
PUBLIC_API_BASE_URL="http://localhost:8000"
GITHUB_CLIENT_ID=Iv1.localdevclientid
GITHUB_CLIENT_SECRET=your_local_dev_client_secret
```

### Verification

After configuration:

1. Log into Panino.
2. Open `Tools -> Backup`.
3. Click `Connect GitHub`.
4. Authorize the app on GitHub and return to Panino.
5. Select or create a repository, then run `Back Up Now`.

### Technology Stack

**Frontend:**
- Vue 3, Vite, Tailwind CSS, Pinia
- CR-SQLite WASM for local database
- MarkdownIt for rendering

**Backend (optional):**
- Node.js, Express, SQLite
- WebSocket for sync notifications
- JWT authentication
- Puppeteer for PDF generation

### Architecture

Notes are stored locally in SQLite using WebAssembly. The app functions completely offline. When backend sync is enabled, changes are replicated using CR-SQLite's conflict-free replication to a per-user database on the server. WebSocket connections provide real-time sync notifications.

## License

AGPL-3.0 - See [LICENSE](LICENSE) for details.
