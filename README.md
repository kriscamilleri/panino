# Panino ~ Pretty Neat Notes

A local-first markdown note-taking application with optional cloud sync.

## Features
- Local SQLite storage via WebAssembly
- Optional multi-device sync using CR-SQLite
- Markdown editing with live preview
- Custom styling for preview and print
- Image uploads and management
- Import/export in multiple formats
- Full-text search
- Files and folders 
- Responsive web interface

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

## Quick Start

### Prerequisites
- Docker & Docker Compose

### Environment Variables
Create a `.env` file in the root directory:
```
# Database
COUCHDB_USER=admin
COUCHDB_PASSWORD=password
COUCHDB_URL=http://couchdb:5984
COUCHDB_HOST=couchdb 

# Captcha (optional)
TURNSTILE_SECRET_KEY={TURNSTILE_SECRET_KEY}
TURNSTILE_SITE_KEY={TURNSTILE_SITE_KEY}
```

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

## Architecture

Notes are stored locally in SQLite using WebAssembly. The app functions completely offline. When backend sync is enabled, changes are replicated using CR-SQLite's conflict-free replication to a per-user database on the server. WebSocket connections provide real-time sync notifications.

## Data Export

- JSON: Full backup in native format
- StackEdit: Compatible with StackEdit editor
- ZIP: Markdown files in folder structure
- SQLite: Raw database export

## License

AGPL-3.0 - See [LICENSE](LICENSE) for details.