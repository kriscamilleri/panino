#!/bin/bash
# sudo-setup.sh: A script to safely grant passwordless sudo for the deploy script.

set -e

# Check for the correct number of arguments
if [ "$#" -ne 2 ]; then
  echo "❌ Error: Invalid number of arguments."
  echo "Usage: sudo $0 <username> <absolute_project_path>"
  echo "Example: sudo $0 deployer /home/deployer/my-app"
  exit 1
fi

# Check if the script is run as root
if [ "$(id -u)" -ne 0 ]; then
  echo "❌ Error: This script must be run with sudo."
  echo "Usage: sudo $0 <username> <absolute_project_path>"
  exit 1
fi

USERNAME=$1
PROJECT_PATH=$2
DEPLOY_SCRIPT_PATH="$PROJECT_PATH/deploy.sh"
SUDOERS_FILE="/etc/sudoers.d/99-$USERNAME-deploy"

# Verify that the deploy.sh script actually exists
if [ ! -f "$DEPLOY_SCRIPT_PATH" ]; then
  echo "❌ Error: The script '$DEPLOY_SCRIPT_PATH' does not exist."
  exit 1
fi

# Create the content of the sudoers file
SUDOERS_CONTENT="$USERNAME ALL=(ALL) NOPASSWD: $DEPLOY_SCRIPT_PATH"

echo "⚙️  Creating sudoers rule..."
echo "    User: $USERNAME"
echo "    Command: $DEPLOY_SCRIPT_PATH"
echo "    File: $SUDOERS_FILE"

# Write the rule to the new file
echo "$SUDOERS_CONTENT" > "$SUDOERS_FILE"

# Set the correct permissions for the file (this is very important!)
chmod 0440 "$SUDOERS_FILE"

echo "✅ Success! The sudo rule has been created."
echo "You can verify the file's content with: sudo cat $SUDOERS_FILE"