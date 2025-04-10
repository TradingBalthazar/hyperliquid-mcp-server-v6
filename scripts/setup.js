/**
 * Hyperliquid MCP Server Setup Script
 * 
 * This script performs additional setup tasks for the Hyperliquid MCP Server.
 * It can be extended to include more complex setup logic as needed.
 */

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

// Get the main project directory (one level up from the current directory)
const mainProjectDir = path.resolve(__dirname, '../../');
console.log(`Main project directory: ${mainProjectDir}`);

// Function to check if a file exists
function fileExists(filePath) {
  try {
    return fs.existsSync(filePath);
  } catch (err) {
    return false;
  }
}

// Function to create a directory if it doesn't exist
function ensureDirectoryExists(dirPath) {
  if (!fileExists(dirPath)) {
    fs.mkdirSync(dirPath, { recursive: true });
    console.log(`Created directory: ${dirPath}`);
  }
}

// Function to copy a file
function copyFile(source, destination) {
  try {
    fs.copyFileSync(source, destination);
    console.log(`Copied ${source} to ${destination}`);
  } catch (err) {
    console.error(`Error copying ${source} to ${destination}:`, err);
  }
}

// Main setup function
function setup() {
  try {
    console.log('Starting additional setup tasks...');

    // Ensure the build directory exists
    const buildDir = path.resolve(__dirname, '../build');
    ensureDirectoryExists(buildDir);

    // Make the build/index.js file executable if it exists
    const indexJsPath = path.join(buildDir, 'index.js');
    if (fileExists(indexJsPath)) {
      try {
        fs.chmodSync(indexJsPath, '755');
        console.log(`Made ${indexJsPath} executable`);
      } catch (err) {
        console.error(`Error making ${indexJsPath} executable:`, err);
      }
    }

    // Check if the Next.js project has the required components
    const componentsDir = path.join(mainProjectDir, 'src/components/ui');
    if (!fileExists(componentsDir)) {
      console.warn('Warning: UI components directory not found. The dashboard may not work correctly.');
      console.warn('Make sure you have shadcn/ui components installed in your Next.js project.');
    }

    console.log('Additional setup tasks completed successfully.');
  } catch (err) {
    console.error('Error during setup:', err);
    process.exit(1);
  }
}

// Run the setup
setup();