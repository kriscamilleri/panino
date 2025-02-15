#!/usr/bin/env node

const fs = require('fs');
const path = require('path');
const minimist = require('minimist');
const { execSync } = require('child_process');

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

// Function to check if running with sudo
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

// Function to run certbot
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
const envPath = path.join(__dirname, 'frontend', '.env');
const envContent = `# Production environment variables
# Generated for ${fullDomain}
VITE_API_BASE_URL=${fullDomain}
VITE_COUCHDB_PORT=443
VITE_SIGNUP_PORT=443
VITE_IMAGE_PORT=443
`;
try {
    fs.writeFileSync(envPath, envContent);
    console.log(`Successfully created .env with domain: ${fullDomain}`);
    console.log("ENV PATH IS THIS: "+ envPath);
    console.log("ENV CONTENT IS THIS: "+ envContent);
} catch (error) {
    console.error('Error writing .env file:', error);
    process.exit(1);
}

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

// Process nginx configuration
console.log('Creating nginx configuration...');
const nginxTemplatePath = path.join(__dirname, 'nginx.conf.template');
const nginxOutputPath = path.join(__dirname, 'nginx.conf');

if (fs.existsSync(nginxTemplatePath)) {
    try {
        let nginxConfig = fs.readFileSync(nginxTemplatePath, 'utf8');
        nginxConfig = nginxConfig.replace(/\${DOMAIN}/g, domain);
        fs.writeFileSync(nginxOutputPath, nginxConfig);
        console.log('Successfully created nginx.conf');

        // If we're root, copy to nginx directory
        if (checkSudo()) {
            console.log('Copying nginx configuration to /etc/nginx/sites-available/...');
            execSync(`cp ${nginxOutputPath} /etc/nginx/sites-available/${domain}`);
            
            // Create symlink if it doesn't exist
            const symlinkPath = `/etc/nginx/sites-enabled/${domain}`;
            if (!fs.existsSync(symlinkPath)) {
                execSync(`ln -s /etc/nginx/sites-available/${domain} ${symlinkPath}`);
            }
            
            // Test nginx configuration
            try {
                execSync('nginx -t', { stdio: 'inherit' });
                console.log('Nginx configuration test passed');
                
                // Reload nginx
                execSync('systemctl reload nginx');
                console.log('Nginx reloaded successfully');
            } catch (error) {
                console.error('Nginx configuration test failed:', error.message);
                // Remove the problematic config
                execSync(`rm /etc/nginx/sites-available/${domain}`);
                if (fs.existsSync(symlinkPath)) {
                    execSync(`rm ${symlinkPath}`);
                }
                process.exit(1);
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
    console.log('No nginx.conf.template found, skipping nginx configuration');
}

// Setup SSL if requested
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