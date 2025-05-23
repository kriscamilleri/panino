#!/usr/bin/env node

const fs = require('fs');
const path = require('path');
const minimist = require('minimist');
const { execSync } = require('child_process');
require('dotenv').config();

// Parse command line arguments
const argv = minimist(process.argv.slice(2), {
    string: ['domain', 'email'],
    boolean: ['skip-ssl'],
    default: {
        domain: 'localhost',
        'skip-ssl': false
    }
});

// Validate domain name and email
if (!argv.domain) {
    console.error('Please provide a domain name using --domain');
    process.exit(1);
}

if (!argv['skip-ssl'] && !argv.email) {
    console.error('Please provide an email address using --email (required for SSL setup)');
    console.error('Or use --skip-ssl to skip SSL certificate generation');
    process.exit(1);
}

const domain = argv.domain.replace(/^https?:\/\//, ''); // Remove protocol if present
const fullDomain = `https://${domain}`;

// Define paths
const projectRoot = process.cwd(); // Adjust if needed
const frontendPath = path.join(projectRoot, 'frontend');
const distFolderPath = path.join(frontendPath, 'dist');
const wwwRoot = `/var/www/${domain}`; // e.g. /var/www/example.com

// Get TURNSTILE_SITE_KEY from environment variables
const turnstileSiteKey = process.env.TURNSTILE_SITE_KEY;

if (!turnstileSiteKey) {
    console.error('TURNSTILE_SITE_KEY environment variable is not set');
    process.exit(1);
}

//1. Function to check if running with sudo
function checkSudo() {
    try {
        execSync('test "$(id -u)" -eq 0', { stdio: 'ignore' });
        return true;
    } catch (error) {
        return false;
    }
}

// Function to check if certbot is installed
function checkCertbot() {
    try {
        execSync('which certbot', { stdio: 'ignore' });
        return true;
    } catch (error) {
        return false;
    }
}

// Function to check if nginx is installed
function checkNginx() {
    try {
        execSync('which nginx', { stdio: 'ignore' });
        return true;
    } catch (error) {
        return false;
    }
}

//2. Function to run certbot
async function setupSSL() {
    if (argv['skip-ssl']) {
        console.log('Skipping SSL setup as requested');
        return;
    }

    if (!checkSudo()) {
        console.error('SSL setup requires sudo privileges');
        console.error('Please run the script with sudo or use --skip-ssl');
        process.exit(1);
    }

    if (!checkCertbot()) {
        console.error('Certbot is not installed');
        console.error('Please install certbot first or use --skip-ssl');
        process.exit(1);
    }

    if (!checkNginx()) {
        console.error('Nginx is not installed');
        console.error('Please install nginx first or use --skip-ssl');
        process.exit(1);
    }

    console.log('Setting up SSL certificate...');

    try {
        // Attempt to obtain SSL certificate
        const certbotCommand = `certbot certonly --nginx -d ${domain} -m ${argv.email} --agree-tos --non-interactive`;
        console.log(`Running: ${certbotCommand}`);
        execSync(certbotCommand, { stdio: 'inherit' });
        console.log('SSL certificate obtained successfully');
    } catch (error) {
        console.error('Error obtaining SSL certificate:', error.message);
        process.exit(1);
    }
}

// Create production environment file
console.log('Creating production environment file...');
const envPath = path.join(frontendPath, '.env.production');
const envContent = `# Production environment variables
# Generated for ${fullDomain}
VITE_API_BASE_URL=${fullDomain}
VITE_COUCHDB_PORT=443
VITE_SIGNUP_PORT=443
VITE_IMAGE_PORT=443
VITE_TURNSTILE_SITE_KEY=${turnstileSiteKey}
`;

fs.writeFileSync(envPath, envContent);
console.log('Successfully created .env.production file');

//4. Update the build process to ensure it's in production mode
try {
    console.log('==> Installing NPM dependencies in ./frontend ...');
    execSync('npm install', { cwd: frontendPath, stdio: 'inherit' });

    console.log('==> Running production build in ./frontend ...');
    // Force production mode
    execSync('NODE_ENV=production npm run build', {
        cwd: frontendPath,
        stdio: 'inherit',
        env: { ...process.env, NODE_ENV: 'production' }
    });
} catch (err) {
    console.error('ERROR during frontend build:', err);
    process.exit(1);
}

// 5. Build the frontend
try {
    console.log('==> Installing NPM dependencies in ./frontend ...');
    execSync('npm install', { cwd: frontendPath, stdio: 'inherit' });

    console.log('==> Running npm run build in ./frontend ...');
    execSync('npm run build', { cwd: frontendPath, stdio: 'inherit' });
} catch (err) {
    console.error('ERROR during frontend build:', err);
    process.exit(1);
}

// 6. If there exists a dist folder /var/www/<SITENAME>/dist, remove it
try {
    console.log(`==> Removing existing dist folder at ${wwwRoot}/dist ...`);
    execSync(`rm -rf "${wwwRoot}/dist"`, { stdio: 'inherit' });
}
catch (err) {
    console.error('Warning: Could not remove existing dist folder:', err);
}

// 7. Copy the dist folder to /var/www/<SITENAME>/dist
try {
    console.log(`==> Copying ${distFolderPath} to ${wwwRoot}/dist ...`);
    execSync(`mkdir -p "${wwwRoot}"`, { stdio: 'inherit' });
    execSync(`cp -R "${distFolderPath}" "${wwwRoot}/dist"`, { stdio: 'inherit' });
} catch (err) {
    console.error('ERROR copying dist folder:', err);
    process.exit(1);
}

// 8. Process nginx configuration
console.log('Creating nginx configuration...');
const nginxTemplatePath = path.join(__dirname, 'nginx.conf.template');
const nginxOutputPath = path.join(__dirname, 'nginx.conf');

if (fs.existsSync(nginxTemplatePath)) {
    try {
        let nginxConfig = fs.readFileSync(nginxTemplatePath, 'utf8');

        // Replace domain placeholder
        nginxConfig = nginxConfig.replace(/\${DOMAIN}/g, domain);

        // Write to temporary file first
        fs.writeFileSync(nginxOutputPath, nginxConfig);
        console.log('Successfully created nginx.conf');

        // If we're root, install the nginx configuration
        if (checkSudo()) {
            console.log('Installing nginx configuration...');

            // Define paths
            const availablePath = `/etc/nginx/sites-available/${domain}`;
            const enabledPath = `/etc/nginx/sites-enabled/${domain}`;

            // Remove existing configuration and symlinks
            console.log('Removing any existing configuration...');
            try {
                if (fs.existsSync(enabledPath)) {
                    execSync(`rm -f ${enabledPath}`);
                }
                if (fs.existsSync(availablePath)) {
                    execSync(`rm -f ${availablePath}`);
                }
            } catch (err) {
                console.log('Warning: Could not remove existing files:', err.message);
            }

            console.log('Copying configuration to sites-available...');
            execSync(`cp ${nginxOutputPath} ${availablePath}`);

            console.log('Creating symlink in sites-enabled...');
            execSync(`ln -sf ${availablePath} ${enabledPath}`);

            // Test the configuration
            try {
                console.log('Testing nginx configuration...');
                execSync('nginx -t', { stdio: 'inherit' });

                console.log('Reloading nginx...');
                execSync('systemctl reload nginx');

                console.log('Nginx configuration installed and tested successfully');
            } catch (error) {
                console.error('Nginx configuration test failed');
                console.error('Removing invalid configuration...');

                // Clean up invalid configuration
                try {
                    if (fs.existsSync(enabledPath)) {
                        execSync(`rm -f ${enabledPath}`);
                    }
                    if (fs.existsSync(availablePath)) {
                        execSync(`rm -f ${availablePath}`);
                    }
                } catch (err) {
                    console.log('Warning: Could not clean up files:', err.message);
                }

                throw error;
            }
        } else {
            console.log('Not running as root - nginx configuration file created but not installed');
            console.log(`Manual installation required: Copy ${nginxOutputPath} to /etc/nginx/sites-available/`);
        }
    } catch (error) {
        console.error('Error processing nginx configuration:', error);
        process.exit(1);
    }
} else {
    console.error('nginx.conf.template not found!');
    console.error('Please ensure nginx.conf.template exists in the project root');
    process.exit(1);
}

// 9. Setup SSL if requested
setupSSL().then(() => {

    if (!checkSudo()) {
        console.log('\n2. Install nginx configuration (requires sudo):');
        console.log(`   sudo cp ${nginxOutputPath} /etc/nginx/sites-available/${domain}`);
        console.log(`   sudo ln -s /etc/nginx/sites-available/${domain} /etc/nginx/sites-enabled/`);
        console.log('   sudo nginx -t');
        console.log('   sudo systemctl reload nginx');
    }
    if (argv['skip-ssl']) {
        console.log('\n3. Setup SSL certificate (requires sudo):');
        console.log(`   sudo certbot certonly --nginx -d ${domain} -m your@email.com --agree-tos`);
    }
}).catch(error => {
    console.error('Setup failed:', error);
    process.exit(1);
});