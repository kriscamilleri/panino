# Panino ~ Pretty Neat Notes

A browser based, local-first markdown note-taking Progressive Web App (PWA) with optional cloud sync.

## Features
- 🌐 **Progressive Web App** - Install on any device, works offline
- 💾 Local SQLite storage via WebAssembly
- 🔄 Optional multi-device sync using CR-SQLite
- ✍️ Markdown editing with live preview
- 🎨 Custom styling for preview and print
- 🖼️ Image uploads and management
- 📦 Import/export in multiple formats
- 🔍 Full-text search
- 📁 Files and folders 
- 📱 Responsive web interface
- ⚡ Lightning-fast offline access
- 🧩 Front‑matter metadata variables for preview & PDF

## Technology Stack

**Frontend:**
- Vue 3, Vite, Tailwind CSS, Pinia
- CR-SQLite WASM for local database
- MarkdownIt for rendering

**Backend (optional):**
- Node.js, Express, SQLite
- WebSocket for sync notifications
- JWT authentication
- Puppeteer for PDF generation

## Architecture

Notes are stored locally in SQLite using WebAssembly. The app functions completely offline. When backend sync is enabled, changes are replicated using CR-SQLite's conflict-free replication to a per-user database on the server. WebSocket connections provide real-time sync notifications.

## Data Export

- JSON: Full backup in native format
- StackEdit: Compatible with StackEdit editor
- ZIP: Markdown files in folder structure
- SQLite: Raw database export

## Metadata Variables (Front‑Matter)

Panino supports document‑level variables defined in a YAML‑style front‑matter block at the very top of a note. The block is **not rendered** in the preview or PDF. You can reference any variable in the document using `{{ Variable Name }}` and it will be replaced in both preview and print output.

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

## Quick Start

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


### Environment Variables

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
# Domain name used by the Nginx setup script (e.g., notes.example.com)
DOMAIN="panino.sh"
# Your email address for Let's Encrypt SSL certificate registration.
EMAIL="your-email@example.com"
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
> - SMTP_*: These settings are provided by your email service (e.g., Mailgun, SendGrid, Amazon SES, or your personal email provider).


## License

AGPL-3.0 - See [LICENSE](LICENSE) for details.
