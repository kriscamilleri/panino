#!/bin/bash

# Exit on error
set -e

# Default values
DOMAIN="localhost"
SKIP_SSL=false
EMAIL=""

# Parse arguments
while [[ $# -gt 0 ]]; do
    case "$1" in
        --domain)
            DOMAIN="$2"
            shift 2
            ;;
        --email)
            EMAIL="$2"
            shift 2
            ;;
        --skip-ssl)
            SKIP_SSL=true
            shift
            ;;
        *)
            echo "Unknown argument: $1"
            exit 1
            ;;
    esac
done

# Validate domain
if [[ -z "$DOMAIN" ]]; then
    echo "Error: Please provide a domain name using --domain"
    exit 1
fi

# Validate email for SSL setup
if [[ "$SKIP_SSL" = false && -z "$EMAIL" ]]; then
    echo "Error: Please provide an email using --email for SSL setup or use --skip-ssl to skip SSL setup."
    exit 1
fi

# Remove protocol from domain if present
DOMAIN=${DOMAIN#https://}
DOMAIN=${DOMAIN#http://}
FULL_DOMAIN="https://$DOMAIN"

# Define paths
PROJECT_ROOT=$(pwd)
FRONTEND_PATH="$PROJECT_ROOT/frontend"
DIST_FOLDER_PATH="$FRONTEND_PATH/dist"
WWW_ROOT="/var/www/$DOMAIN"

# Check if script is run as root
check_sudo() {
    if [[ "$EUID" -ne 0 ]]; then
        echo "Error: This script requires sudo privileges."
        exit 1
    fi
}

# Check if a command exists
command_exists() {
    command -v "$1" >/dev/null 2>&1
}

# Check for required dependencies
check_dependencies() {
    if [[ "$SKIP_SSL" = false ]]; then
        command_exists certbot || { echo "Error: Certbot is not installed."; exit 1; }
    fi
    command_exists nginx || { echo "Error: Nginx is not installed."; exit 1; }
}

# Install SSL certificate
setup_ssl() {
    if [[ "$SKIP_SSL" = true ]]; then
        echo "Skipping SSL setup as requested."
        return
    fi

    check_sudo

    echo "Setting up SSL certificate..."
    certbot certonly --nginx -d "$DOMAIN" -m "$EMAIL" --agree-tos --non-interactive
    echo "SSL certificate obtained successfully."
}

# Create production environment file
create_env_file() {
    echo "Creating production environment file..."
    cat <<EOF >"$FRONTEND_PATH/.env.production"
# Production environment variables
# Generated for $FULL_DOMAIN
VITE_API_BASE_URL=$FULL_DOMAIN
VITE_COUCHDB_PORT=443
VITE_SIGNUP_PORT=443
VITE_IMAGE_PORT=443
EOF
}

# Build the frontend
build_frontend() {
    echo "==> Installing NPM dependencies in ./frontend ..."
    (cd "$FRONTEND_PATH" && npm install)

    echo "==> Running production build in ./frontend ..."
    NODE_ENV=production (cd "$FRONTEND_PATH" && npm run build)
}

# Deploy the frontend
deploy_frontend() {
    echo "==> Removing existing dist folder at $WWW_ROOT/dist ..."
    rm -rf "$WWW_ROOT/dist" || echo "Warning: Could not remove existing dist folder."

    echo "==> Copying $DIST_FOLDER_PATH to $WWW_ROOT/dist ..."
    mkdir -p "$WWW_ROOT"
    cp -R "$DIST_FOLDER_PATH" "$WWW_ROOT/dist"
}

# Configure Nginx
configure_nginx() {
    NGINX_TEMPLATE_PATH="$PROJECT_ROOT/nginx.conf.template"
    NGINX_OUTPUT_PATH="$PROJECT_ROOT/nginx.conf"

    if [[ ! -f "$NGINX_TEMPLATE_PATH" ]]; then
        echo "Error: nginx.conf.template not found!"
        exit 1
    fi

    echo "Creating Nginx configuration..."
    sed "s/\${DOMAIN}/$DOMAIN/g" "$NGINX_TEMPLATE_PATH" >"$NGINX_OUTPUT_PATH"

    if [[ "$EUID" -ne 0 ]]; then
        echo "Not running as root - nginx configuration file created but not installed."
        echo "Manual installation required: Copy $NGINX_OUTPUT_PATH to /etc/nginx/sites-available/"
        return
    fi

    echo "Installing Nginx configuration..."
    AVAILABLE_PATH="/etc/nginx/sites-available/$DOMAIN"
    ENABLED_PATH="/etc/nginx/sites-enabled/$DOMAIN"

    rm -f "$ENABLED_PATH" "$AVAILABLE_PATH" 2>/dev/null || true
    cp "$NGINX_OUTPUT_PATH" "$AVAILABLE_PATH"
    ln -s "$AVAILABLE_PATH" "$ENABLED_PATH"

    echo "Testing Nginx configuration..."
    nginx -t

    echo "Reloading Nginx..."
    systemctl reload nginx

    echo "Nginx configuration installed and tested successfully."
}

# Main execution
check_dependencies
create_env_file
build_frontend
deploy_frontend
configure_nginx
setup_ssl

echo "Deployment completed successfully!"
