#!/bin/bash

# Default values
DOMAIN="localhost"
SKIP_SSL=false
EMAIL=""
VITE_TURNSTILE_SITE_KEY=""

# Load environment variables from .env file if it exists
if [ -f ".env" ]; then
  echo "Loading configuration from .env file..."
  while IFS='=' read -r key value || [ -n "$key" ]; do
    # Skip comments and empty lines
    [[ $key =~ ^#.*$ ]] && continue
    [[ -z "$key" ]] && continue
    
    # Remove quotes and whitespace from the value
    value=$(echo "$value" | sed -e 's/^[[:space:]]*//' \
                                -e 's/[[:space:]]*$//' \
                                -e 's/^"//g' \
                                -e 's/"$//g' \
                                -e "s/^'//g" \
                                -e "s/'$//g")
    
    # Set environment variables
    if [ "$key" = "DOMAIN" ]; then
      DOMAIN="$value"
    elif [ "$key" = "EMAIL" ]; then
      EMAIL="$value"
    elif [ "$key" = "SKIP_SSL" ]; then
      if [ "$value" = "true" ] || [ "$value" = "1" ] || [ "$value" = "yes" ]; then
        SKIP_SSL=true
      fi
    elif [ "$key" = "VITE_TURNSTILE_SITE_KEY" ]; then
      VITE_TURNSTILE_SITE_KEY="$value"
    fi
  done < .env
fi

# Check for environment variables (overrides .env file)
[ -n "$DOMAIN" ] && DOMAIN="$DOMAIN"
[ -n "$EMAIL" ] && EMAIL="$EMAIL"
[ -n "$VITE_TURNSTILE_SITE_KEY" ] && VITE_TURNSTILE_SITE_KEY="$VITE_TURNSTILE_SITE_KEY"
if [ "$SKIP_SSL" = "true" ] || [ "$SKIP_SSL" = "1" ] || [ "$SKIP_SSL" = "yes" ]; then
  SKIP_SSL=true
fi

# Parse command line arguments (overrides both .env and environment variables)
while [[ $# -gt 0 ]]; do
  case $1 in
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
      echo "Unknown option: $1"
      exit 1
      ;;
  esac
done

# Validate domain name and email
if [ -z "$DOMAIN" ]; then
  echo "Please provide a domain name using --domain"
  exit 1
fi

if [ "$SKIP_SSL" = false ] && [ -z "$EMAIL" ]; then
  echo "Please provide an email address using --email (required for SSL setup)"
  echo "Or use --skip-ssl to skip SSL certificate generation"
  exit 1
fi

# Remove protocol if present in domain
DOMAIN=$(echo "$DOMAIN" | sed -E 's|^https?://||')
FULL_DOMAIN="https://$DOMAIN"

# Define paths
PROJECT_ROOT=$(pwd) # Adjust if needed
FRONTEND_PATH="$PROJECT_ROOT/frontend"
DIST_FOLDER_PATH="$FRONTEND_PATH/dist"
WWW_ROOT="/var/www/$DOMAIN" # e.g. /var/www/example.com

# Function to check if running with sudo
check_sudo() {
  if [ "$(id -u)" -eq 0 ]; then
    return 0
  else
    return 1
  fi
}

# Function to check if certbot is installed
check_certbot() {
  if command -v certbot >/dev/null 2>&1; then
    return 0
  else
    return 1
  fi
}

# Function to check if nginx is installed
check_nginx() {
  if command -v nginx >/dev/null 2>&1; then
    return 0
  else
    return 1
  fi
}

# Function to run certbot
setup_ssl() {
  if [ "$SKIP_SSL" = true ]; then
    echo "Skipping SSL setup as requested"
    return 0
  fi

  if ! check_sudo; then
    echo "SSL setup requires sudo privileges"
    echo "Please run the script with sudo or use --skip-ssl"
    exit 1
  fi

  if ! check_certbot; then
    echo "Certbot is not installed"
    echo "Please install certbot first or use --skip-ssl"
    exit 1
  fi

  if ! check_nginx; then
    echo "Nginx is not installed"
    echo "Please install nginx first or use --skip-ssl"
    exit 1
  fi

  echo "Attempting to obtain an SSL certificate..."
  certbot_command="certbot certonly --nginx -d $DOMAIN -m $EMAIL --agree-tos --non-interactive"
  echo "Running: $certbot_command"
  if ! $certbot_command; then
    echo "Error obtaining SSL certificate"
    exit 1
  fi
  echo "SSL certificate obtained successfully"
}

################################################################################
# 1. Obtain SSL certificate **before** setting up the main nginx config
################################################################################

setup_ssl

################################################################################
# 2. Create production environment file
################################################################################

echo "Creating production environment file..."
RELEASE_ID=$(git rev-parse HEAD 2>/dev/null || echo "unknown")
ENV_PATH="$FRONTEND_PATH/.env.production.local"
ENV_CONTENT="# Production environment variables
# Generated for $FULL_DOMAIN
VITE_API_SERVICE_URL=$FULL_DOMAIN/api
VITE_TURNSTILE_SITE_KEY=${VITE_TURNSTILE_SITE_KEY:-}
VITE_APP_VERSION=$RELEASE_ID"

echo "$ENV_CONTENT" > "$ENV_PATH"

################################################################################
# 3. Build frontend
################################################################################

echo "==> Installing NPM dependencies in ./frontend ..."
if ! (cd "$FRONTEND_PATH" && npm ci); then
  echo "ERROR during frontend dependencies installation"
  exit 1
fi

echo "==> Running production build in ./frontend ..."
if ! (cd "$FRONTEND_PATH" && NODE_ENV=production npm run build); then
  echo "ERROR during frontend build"
  exit 1
fi

################################################################################
# 4. Copy build output to /var/www/<DOMAIN>
################################################################################

echo "==> Removing existing dist folder at $WWW_ROOT/dist ..."
rm -rf "$WWW_ROOT/dist" 2>/dev/null || echo "Warning: Could not remove existing dist folder"

echo "==> Copying $DIST_FOLDER_PATH to $WWW_ROOT/dist ..."
if ! mkdir -p "$WWW_ROOT"; then
  echo "ERROR creating directory $WWW_ROOT"
  exit 1
fi

if ! cp -R "$DIST_FOLDER_PATH" "$WWW_ROOT/dist"; then
  echo "ERROR copying dist folder"
  exit 1
fi

################################################################################
# 5. Process and install nginx configuration
################################################################################

echo "Creating nginx configuration..."
NGINX_TEMPLATE_PATH="$PROJECT_ROOT/nginx.conf.template"
NGINX_OUTPUT_PATH="$PROJECT_ROOT/nginx.conf"

if [ -f "$NGINX_TEMPLATE_PATH" ]; then
  # Replace domain placeholder
  sed "s/\${DOMAIN}/$DOMAIN/g" "$NGINX_TEMPLATE_PATH" > "$NGINX_OUTPUT_PATH"
  echo "Successfully created nginx.conf"

  # If we're root, install the nginx configuration
  if check_sudo; then
    echo "Installing nginx configuration..."
    
    AVAILABLE_PATH="/etc/nginx/sites-available/$DOMAIN"
    ENABLED_PATH="/etc/nginx/sites-enabled/$DOMAIN"
    
    # Remove existing configuration
    echo "Removing any existing configuration..."
    rm -f "$ENABLED_PATH" 2>/dev/null
    rm -f "$AVAILABLE_PATH" 2>/dev/null
    
    echo "Copying configuration to sites-available..."
    if ! cp "$NGINX_OUTPUT_PATH" "$AVAILABLE_PATH"; then
      echo "Failed to copy nginx config"
      exit 1
    fi
    
    echo "Creating symlink in sites-enabled..."
    if ! ln -sf "$AVAILABLE_PATH" "$ENABLED_PATH"; then
      echo "Failed to create symlink"
      exit 1
    fi
    
    echo "Testing nginx configuration..."
    if ! nginx -t; then
      echo "Nginx configuration test failed, removing invalid configuration..."
      rm -f "$ENABLED_PATH" 2>/dev/null
      rm -f "$AVAILABLE_PATH" 2>/dev/null
      exit 1
    fi
    
    echo "Reloading nginx..."
    systemctl reload nginx || {
      echo "Failed to reload nginx"
      exit 1
    }
    echo "Nginx configuration installed and tested successfully"
  else
    echo "Not running as root - nginx configuration file created but not installed"
    echo "Manual installation required: Copy $NGINX_OUTPUT_PATH to /etc/nginx/sites-available/"
  fi
else
  echo "nginx.conf.template not found!"
  echo "Please ensure nginx.conf.template exists in the project root"
  exit 1
fi

################################################################################
# 6. Wrap-up and manual steps
################################################################################

if ! check_sudo; then
  echo
  echo "Additional manual steps required (running without sudo):"
  echo "1) Copy the generated nginx config to /etc/nginx/sites-available/"
  echo "2) ln -s /etc/nginx/sites-available/$DOMAIN /etc/nginx/sites-enabled/$DOMAIN"
  echo "3) sudo nginx -t && sudo systemctl reload nginx"
fi

if [ "$SKIP_SSL" = true ]; then
  echo
  echo "If you want HTTPS later, run certbot manually (requires sudo), for example:"
  echo "  sudo certbot certonly --nginx -d $DOMAIN -m you@example.com --agree-tos"
fi

echo
echo "Deployment completed successfully with the following configuration:"
echo "Domain: $DOMAIN"
echo "Full Domain: $FULL_DOMAIN"
echo "Skip SSL: $SKIP_SSL"
if [ "$SKIP_SSL" = false ]; then
  echo "Email: $EMAIL"
fi

################################################################################
# 7. Rebuild and restart Docker containers
################################################################################

# This used to run in the background "to save CI minutes":
#
#   nohup bash -c "... docker compose up --build -d api-service && echo done >> log 2>&1" &
#
# Two things were wrong with it. The redirect bound only to the `echo`, so
# `docker compose` still wrote to the inherited SSH channel — when the deploy
# session closed, the build died on a broken pipe. And because the deploy job
# returned as soon as the background process was launched, the workflow reported
# success whether or not the backend was ever rebuilt.
#
# That is exactly what happened on 2026-08-16: `Deploy to VPS` went green, the
# frontend was published, and the api-service container kept running the previous
# image for the next half hour. The DX-10 runtime upgrade appeared deployed and
# was not. A deploy step that can silently not deploy is worse than a slow one,
# so this now runs synchronously and its exit status is the deploy's exit status.
echo
echo "==> Rebuilding and restarting Docker containers ..."
if ! (cd "$PROJECT_ROOT" && docker compose up --build -d api-service); then
  echo "ERROR: docker compose up --build failed; the previous container is still running" >&2
  exit 1
fi

echo "==> Verifying the container came back up ..."
for _ in $(seq 1 30); do
  if [ "$(docker inspect -f '{{.State.Running}}' panino-api-service-1 2>/dev/null)" = "true" ]; then
    echo "api-service is running Node $(docker exec panino-api-service-1 node --version 2>/dev/null || echo 'unknown')"
    break
  fi
  sleep 2
done

################################################################################
# 8. Reclaim old image layers, keeping one generation for rollback
################################################################################

# Every rebuild moves the `panino-api-service:latest` tag to the new image and
# leaves the old one untagged. Nothing reclaimed those, so they accumulated: by
# 2026-08-16 the server held 11 dangling images and the disk hit 100% full, which
# blocked that day's deploy outright and — more seriously — puts a SQLite
# application at risk of failed writes and WAL checkpoints.
#
# The newest dangling image is the build this deploy just replaced, so it is the
# rollback artifact and is deliberately kept. Everything older is dead weight.
#
# Cleanup never fails the deploy: the new container is already up and serving by
# this point, and a full disk is a problem for the *next* deploy, not this one.
# `docker rmi` also legitimately refuses images still referenced as a parent
# layer by another image, which is not an error worth aborting for.
echo
echo "==> Reclaiming old image layers (keeping the previous build for rollback) ..."
stale_images="$(
  docker images --filter dangling=true --format '{{.CreatedAt}}\t{{.ID}}' \
    | sort -r \
    | tail -n +2 \
    | cut -f2
)"

if [ -z "$stale_images" ]; then
  echo "Nothing to reclaim (at most one dangling image present)."
else
  echo "$stale_images" | while read -r image_id; do
    [ -n "$image_id" ] || continue
    if docker rmi "$image_id" >/dev/null 2>&1; then
      echo "  removed $image_id"
    else
      echo "  skipped $image_id (still referenced)"
    fi
  done
fi

echo "Disk after cleanup: $(df -h / | awk 'NR==2 {print $4 " free (" $5 " used)"}')"
