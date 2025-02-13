#!/usr/bin/env node

/**
 * Usage:
 *   sudo node setup-nginx.cjs --site example.com
 *
 * This script:
 *   1) Installs dependencies + builds the Vue frontend in ./frontend/.
 *   2) Copies the ./frontend/dist folder to /var/www/<SITENAME>/dist.
 *   3) Replaces {{SITENAME}} in nginx.conf.template and installs it into
 *      /etc/nginx/sites-available/<SITENAME>.conf.
 *   4) Symlinks that config into /etc/nginx/sites-enabled/.
 *   5) Reloads Nginx.
 */

// Use CommonJS requires instead of import
const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');
const minimist = require('minimist');

// Parse arguments
const args = minimist(process.argv.slice(2));
const siteName = args.site;
if (!siteName) {
  console.error('ERROR: Must specify --site <sitename>');
  process.exit(1);
}

// Define paths
const projectRoot = process.cwd(); // Adjust if needed
const frontendPath = path.join(projectRoot, 'frontend');
const distFolderPath = path.join(frontendPath, 'dist');
const templatePath = path.join(projectRoot, 'nginx.conf.template');
const targetNginxConf = `/etc/nginx/sites-available/${siteName}.conf`;
const symlinkPath = `/etc/nginx/sites-enabled/${siteName}.conf`;
const wwwRoot = `/var/www/${siteName}`; // e.g. /var/www/example.com

// 1. Build the frontend
try {
  console.log('==> Installing NPM dependencies in ./frontend ...');
  execSync('npm install', { cwd: frontendPath, stdio: 'inherit' });

  console.log('==> Running npm run build in ./frontend ...');
  execSync('npm run build', { cwd: frontendPath, stdio: 'inherit' });
} catch (err) {
  console.error('ERROR during frontend build:', err);
  process.exit(1);
}

// 2. Copy the dist folder to /var/www/<SITENAME>/dist
try {
  console.log(`==> Copying ${distFolderPath} to ${wwwRoot}/dist ...`);
  execSync(`mkdir -p "${wwwRoot}"`, { stdio: 'inherit' });
  execSync(`cp -R "${distFolderPath}" "${wwwRoot}/dist"`, { stdio: 'inherit' });
} catch (err) {
  console.error('ERROR copying dist folder:', err);
  process.exit(1);
}

// 3. Load the template and replace placeholders
if (!fs.existsSync(templatePath)) {
  console.error(`ERROR: Template file not found at ${templatePath}`);
  process.exit(1);
}

let template = fs.readFileSync(templatePath, 'utf8');
// Use a global regex to replace all occurrences of {{SITENAME}}
template = template.replace(/\{\{SITENAME\}\}/g, siteName);

// 4. Write the Nginx config to /etc/nginx/sites-available/<SITENAME>.conf
try {
  fs.writeFileSync(targetNginxConf, template, 'utf8');
  console.log(`Wrote Nginx config to ${targetNginxConf}`);
} catch (err) {
  console.error(`ERROR writing Nginx config: ${err.message}`);
  process.exit(1);
}

// 5. Symlink into sites-enabled
try {
  if (fs.existsSync(symlinkPath)) {
    fs.unlinkSync(symlinkPath);
  }
  fs.symlinkSync(targetNginxConf, symlinkPath);
  console.log(`Created symlink: ${symlinkPath} -> ${targetNginxConf}`);
} catch (err) {
  console.error('ERROR creating symlink:', err);
  process.exit(1);
}

// 6. Reload Nginx
try {
  console.log('==> Reloading Nginx ...');
  execSync('systemctl reload nginx');
  console.log('Nginx reloaded successfully.');
} catch (err) {
  console.error('WARNING: Could not reload Nginx automatically. Please reload manually.', err.message);
}

console.log(`\nDone! Your site "${siteName}" is configured at http://${siteName}/`);
