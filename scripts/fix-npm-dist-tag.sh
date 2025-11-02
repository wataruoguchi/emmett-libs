#!/bin/bash
# Script to fix npm dist-tag for packages
# Usage: ./scripts/fix-npm-dist-tag.sh <package-name> <target-version>

set -e

PACKAGE_NAME="$1"
TARGET_VERSION="$2"

if [ -z "$PACKAGE_NAME" ] || [ -z "$TARGET_VERSION" ]; then
  echo "Usage: $0 <package-name> <target-version>"
  echo "Example: $0 @wataruoguchi/emmett-event-store-kysely 2.1.0"
  exit 1
fi

echo "Checking current dist-tag for $PACKAGE_NAME..."
CURRENT_LATEST=$(npm dist-tag ls "$PACKAGE_NAME" 2>/dev/null | grep "latest:" | awk '{print $2}' || echo "")

if [ -z "$CURRENT_LATEST" ]; then
  echo "Error: Could not fetch current dist-tag for $PACKAGE_NAME"
  exit 1
fi

echo "Current 'latest' dist-tag: $CURRENT_LATEST"
echo "Target version: $TARGET_VERSION"

# Check if target version exists on npm
if ! npm view "$PACKAGE_NAME@$TARGET_VERSION" version > /dev/null 2>&1; then
  echo "Error: Version $TARGET_VERSION does not exist on npm for $PACKAGE_NAME"
  exit 1
fi

# Compare versions
if [ "$CURRENT_LATEST" = "$TARGET_VERSION" ]; then
  echo "Dist-tag is already set to $TARGET_VERSION. No action needed."
  exit 0
fi

# Check if target version is higher
CURRENT_NUM=$(echo "$CURRENT_LATEST" | sed 's/[^0-9]//g')
TARGET_NUM=$(echo "$TARGET_VERSION" | sed 's/[^0-9]//g')

if [ "$TARGET_NUM" -lt "$CURRENT_NUM" ] 2>/dev/null; then
  echo "Warning: Target version $TARGET_VERSION appears to be older than current $CURRENT_LATEST"
  read -p "Do you want to continue? (y/N) " -n 1 -r
  echo
  if [[ ! $REPLY =~ ^[Yy]$ ]]; then
    exit 1
  fi
fi

echo "Updating dist-tag 'latest' to $TARGET_VERSION..."
npm dist-tag add "$PACKAGE_NAME@$TARGET_VERSION" latest

echo "✓ Successfully updated dist-tag 'latest' to $TARGET_VERSION for $PACKAGE_NAME"
