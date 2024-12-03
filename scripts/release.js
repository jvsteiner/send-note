// Import required modules
const { execSync } = require("child_process");
const { existsSync } = require("fs");
const path = require("path");

// Function to execute shell commands
function execCommand(command) {
  try {
    return execSync(command, { stdio: "pipe" }).toString().trim();
  } catch (error) {
    console.error(`Error executing command: ${command}`);
    process.exit(1);
  }
}

// Ensure GitHub CLI is installed
try {
  execCommand("gh --version");
} catch {
  console.error("GitHub CLI could not be found. Please install it from https://cli.github.com/.");
  process.exit(1);
}

// Get the current working directory
const currentDir = process.cwd();

// Change to the current directory
process.chdir(currentDir);

// Push tags to the remote repository
execCommand("git push --tags");

// Get the full repository URL
const fullRepo = execCommand("git remote get-url origin");

// Extract the repository name
const repo = fullRepo.replace(/^https:\/\/github.com\//, "").replace(/\.git$/, "");

// Check if the required arguments are supplied
if (process.argv.length !== 3) {
  console.error("Usage: node releaser.js <release_name>");
  process.exit(1);
}

// Command line parameters
const tag = execCommand("git describe --tags --abbrev=0");
const releaseName = process.argv[2];

// Create a new release using the GitHub CLI
try {
  execCommand(
    `gh release create ${tag} --repo ${repo} --title "${releaseName}" --notes "Release created using GitHub CLI."`
  );
} catch {
  console.error("Failed to create the release. Ensure that the repository and tag are correct.");
  process.exit(2);
}

// Files to upload
const files = ["main.js", "styles.css", "manifest.json"];

// Upload files to the release
files.forEach((file) => {
  if (existsSync(file)) {
    try {
      execCommand(`gh release upload ${tag} ${file} --repo ${repo}`);
      console.log(`Successfully uploaded ${file}.`);
    } catch {
      console.error(`Failed to upload ${file}. Ensure the file exists and the release was created successfully.`);
      process.exit(3);
    }
  } else {
    console.error(`File ${file} does not exist.`);
    process.exit(3);
  }
});

console.log("Release created and files uploaded successfully.");
