#!/bin/bash

# Ensure GitHub CLI is installed
if ! command -v gh &> /dev/null
then
    echo "GitHub CLI could not be found. Please install it from https://cli.github.com/."
    exit 1
fi

git push --tags

# Hardcoded repository
REPO="jvsteiner/send-note"  # Replace this with your actual owner/repo

# Check if the required arguments are supplied
if [ "$#" -ne 2 ]; then
    echo "Usage: $0 <tag> <release_name>"
    exit 1
fi

# Command line parameters
TAG="$1"
RELEASE_NAME="$2"

# Create a new release using the GitHub CLI
gh release create "$TAG" \
    --repo "$REPO" \
    --title "$RELEASE_NAME" \
    --notes "Release created using GitHub CLI."

# Check if the release was created successfully
if [ $? -ne 0 ]; then
    echo "Failed to create the release. Ensure that the repository and tag are correct."
    exit 2
fi

# Upload files to the release
for file in "main.js" "styles.css" "manifest.json"; do
    gh release upload "$TAG" "$file" --repo "$REPO"

    # Check if each file was uploaded successfully
    if [ $? -ne 0 ]; then
        echo "Failed to upload $file. Ensure the file exists and the release was created successfully."
        exit 3
    else
        echo "Successfully uploaded $file."
    fi
done

echo "Release created and files uploaded successfully."