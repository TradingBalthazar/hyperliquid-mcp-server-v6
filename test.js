/**
 * Hyperliquid MCP Server Test Script
 * 
 * This script tests the basic functionality of the Hyperliquid MCP Server.
 * It simulates MCP requests and verifies the responses.
 */

import { spawn } from 'child_process';
import { fileURLToPath } from 'url';
import { dirname, resolve } from 'path';
import { setTimeout } from 'timers/promises';

// Get the current directory
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Path to the MCP server executable
const serverPath = resolve(__dirname, 'build/index.js');

// Test MCP requests
const testRequests = [
  // List tools request
  {
    id: '1',
    jsonrpc: '2.0',
    method: 'mcp.listTools',
    params: {}
  },
  // List resources request
  {
    id: '2',
    jsonrpc: '2.0',
    method: 'mcp.listResources',
    params: {}
  }
];

// Function to run the tests
async function runTests() {
  console.log('Starting Hyperliquid MCP Server tests...');
  
  // Start the MCP server process
  const serverProcess = spawn('node', [serverPath], {
    stdio: ['pipe', 'pipe', 'pipe']
  });
  
  // Set up event handlers
  serverProcess.stdout.on('data', (data) => {
    try {
      const response = JSON.parse(data.toString());
      console.log('Received response:', JSON.stringify(response, null, 2));
      
      // Validate the response
      if (response.id && response.result) {
        console.log(`✅ Test ${response.id} passed`);
      } else if (response.error) {
        console.log(`❌ Test ${response.id} failed: ${response.error.message}`);
      }
    } catch (err) {
      console.log('Server output (not JSON):', data.toString());
    }
  });
  
  serverProcess.stderr.on('data', (data) => {
    console.error('Server error:', data.toString());
  });
  
  serverProcess.on('close', (code) => {
    console.log(`Server process exited with code ${code}`);
  });
  
  // Wait for the server to start
  await setTimeout(1000);
  
  // Send test requests
  for (const request of testRequests) {
    console.log(`Sending request: ${JSON.stringify(request)}`);
    serverProcess.stdin.write(JSON.stringify(request) + '\n');
    
    // Wait between requests
    await setTimeout(500);
  }
  
  // Clean up
  console.log('Tests completed, terminating server...');
  serverProcess.kill();
}

// Run the tests
runTests().catch((err) => {
  console.error('Test error:', err);
  process.exit(1);
});