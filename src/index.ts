#!/usr/bin/env node

/**
 * Hyperliquid MCP Server
 * 
 * This MCP server provides tools for interacting with the Hyperliquid exchange API.
 * It allows users to:
 * - Authenticate with their Hyperliquid credentials
 * - Execute trades on the Hyperliquid exchange
 * - Create and run custom trading strategies
 * - Monitor their account and positions
 */

import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ListResourcesRequestSchema,
  ListToolsRequestSchema,
  ReadResourceRequestSchema,
  ErrorCode,
  McpError
} from "@modelcontextprotocol/sdk/types.js";
import { Hyperliquid } from "hyperliquid";
import { ethers } from "ethers";

/**
 * Type definitions for user credentials and strategies
 */
interface UserCredentials {
  privateKey?: string;
  walletAddress?: string;
  testnet: boolean;
  vaultAddress?: string;
}

interface Strategy {
  id: string;
  name: string;
  description: string;
  config: any;
  active: boolean;
}

/**
 * In-memory storage for user credentials and strategies
 * In a production environment, this would be stored in a secure database
 */
const userCredentials: UserCredentials = {
  testnet: true // Default to testnet for safety
};

const strategies: { [id: string]: Strategy } = {};
let hyperliquidClient: Hyperliquid | null = null;

/**
 * Create an MCP server with capabilities for resources and tools
 */
const server = new Server(
  {
    name: "hyperliquid-server",
    version: "0.1.0",
  },
  {
    capabilities: {
      resources: {},
      tools: {},
    },
  }
);

/**
 * Initialize the Hyperliquid client with user credentials
 */
function initializeClient(): Hyperliquid | null {
  try {
    if (!userCredentials.privateKey && !userCredentials.walletAddress) {
      return null;
    }

    const client = new Hyperliquid({
      privateKey: userCredentials.privateKey,
      testnet: userCredentials.testnet,
      walletAddress: userCredentials.walletAddress,
      vaultAddress: userCredentials.vaultAddress,
      enableWs: true
    });

    return client;
  } catch (error) {
    console.error("Failed to initialize Hyperliquid client:", error);
    return null;
  }
}

/**
 * Handler for listing available resources
 * Exposes account information and strategies as resources
 */
server.setRequestHandler(ListResourcesRequestSchema, async () => {
  const resources = [];

  // Only add account resource if credentials are set
  if (userCredentials.privateKey || userCredentials.walletAddress) {
    resources.push({
      uri: "hyperliquid://account",
      mimeType: "application/json",
      name: "Hyperliquid Account",
      description: "Current account information from Hyperliquid"
    });
  }

  // Add strategies as resources
  Object.entries(strategies).forEach(([id, strategy]) => {
    resources.push({
      uri: `hyperliquid://strategy/${id}`,
      mimeType: "application/json",
      name: strategy.name,
      description: `Trading strategy: ${strategy.description}`
    });
  });

  return { resources };
});

/**
 * Handler for reading resources
 * Returns account information or strategy details
 */
server.setRequestHandler(ReadResourceRequestSchema, async (request) => {
  const uri = request.params.uri;
  
  // Handle account resource
  if (uri === "hyperliquid://account") {
    if (!hyperliquidClient) {
      hyperliquidClient = initializeClient();
    }
    
    if (!hyperliquidClient) {
      throw new McpError(
        ErrorCode.InvalidRequest,
        "No credentials provided. Please authenticate first."
      );
    }

    try {
      await hyperliquidClient.connect();
      
      // Get account information
      let accountInfo: any = {};
      
      if (userCredentials.walletAddress) {
        // Get clearinghouse state for perpetuals
        const perpState = await hyperliquidClient.info.perpetuals.getClearinghouseState(
          userCredentials.walletAddress
        );
        
        // Get spot clearinghouse state if available
        let spotState = null;
        try {
          spotState = await hyperliquidClient.info.spot.getSpotClearinghouseState(
            userCredentials.walletAddress
          );
          
          // Get spot meta and asset contexts to get price information
          if (spotState && spotState.balances && spotState.balances.length > 0) {
            const [spotMeta, spotAssetCtxs] = await hyperliquidClient.info.spot.getSpotMetaAndAssetCtxs();
            
            // Create a map of coin to price
            const priceMap: { [key: string]: number } = {};
            spotAssetCtxs.forEach((assetCtx: any) => {
              priceMap[assetCtx.coin] = parseFloat(assetCtx.markPx);
            });
            
            // Ensure USDC has a price of 1
            if (!priceMap["USDC-SPOT"] || priceMap["USDC-SPOT"] === 0) {
              priceMap["USDC-SPOT"] = 1.0;
            }
            
            console.error("MCP Server - Price Map:", priceMap);
            
            // Add price and USD value to each balance
            spotState.balances = spotState.balances.map((balance: any) => {
              const tokenAmount = parseFloat(balance.total);
              const price = priceMap[balance.coin] || 0;
              const usdValue = tokenAmount * price;
              
              console.error(`MCP Server - Balance for ${balance.coin}: Amount=${tokenAmount}, Price=${price}, USD Value=${usdValue}`);
              
              return {
                ...balance,
                price: price.toString(),
                usdValue: usdValue.toString()
              };
            });
          }
        } catch (error) {
          // Spot might not be available, ignore error
          console.error("Error fetching spot data:", error);
        }
        
        accountInfo = {
          perpetuals: perpState,
          spot: spotState,
          network: userCredentials.testnet ? "testnet" : "mainnet"
        };
      }

      return {
        contents: [{
          uri: request.params.uri,
          mimeType: "application/json",
          text: JSON.stringify(accountInfo, null, 2)
        }]
      };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      throw new McpError(
        ErrorCode.InternalError,
        `Failed to fetch account information: ${errorMessage}`
      );
    }
  }
  
  // Handle strategy resources
  if (uri.startsWith("hyperliquid://strategy/")) {
    const strategyId = uri.replace("hyperliquid://strategy/", "");
    const strategy = strategies[strategyId];
    
    if (!strategy) {
      throw new McpError(
        ErrorCode.InvalidRequest,
        `Strategy ${strategyId} not found`
      );
    }
    
    return {
      contents: [{
        uri: request.params.uri,
        mimeType: "application/json",
        text: JSON.stringify(strategy, null, 2)
      }]
    };
  }
  
  throw new McpError(
    ErrorCode.InvalidRequest,
    `Resource not found: ${uri}`
  );
});

/**
 * Handler for listing available tools
 * Exposes tools for authentication, trading, and strategy management
 */
server.setRequestHandler(ListToolsRequestSchema, async () => {
  return {
    tools: [
      // Authentication tool
      {
        name: "authenticate",
        description: "Authenticate with Hyperliquid using private key or wallet address",
        inputSchema: {
          type: "object",
          properties: {
            privateKey: {
              type: "string",
              description: "Private key for authentication (optional if walletAddress is provided)"
            },
            walletAddress: {
              type: "string",
              description: "Wallet address for authentication (optional if privateKey is provided)"
            },
            testnet: {
              type: "boolean",
              description: "Whether to use testnet (default: true)"
            },
            vaultAddress: {
              type: "string",
              description: "Vault address (optional)"
            }
          }
        }
      },
      
      // Market data tools
      {
        name: "get_market_data",
        description: "Get current market data for a specific asset",
        inputSchema: {
          type: "object",
          properties: {
            symbol: {
              type: "string",
              description: "Symbol to get market data for (e.g., BTC-PERP, ETH-SPOT)"
            }
          },
          required: ["symbol"]
        }
      },
      
      // Trading tools
      {
        name: "place_order",
        description: "Place an order on Hyperliquid",
        inputSchema: {
          type: "object",
          properties: {
            symbol: {
              type: "string",
              description: "Symbol to trade (e.g., BTC-PERP, ETH-SPOT)"
            },
            side: {
              type: "string",
              enum: ["buy", "sell"],
              description: "Order side (buy or sell)"
            },
            size: {
              type: "number",
              description: "Order size"
            },
            price: {
              type: "number",
              description: "Limit price (use 0 for market orders)"
            },
            orderType: {
              type: "string",
              enum: ["limit", "market"],
              description: "Order type (limit or market)"
            },
            reduceOnly: {
              type: "boolean",
              description: "Whether the order is reduce-only"
            }
          },
          required: ["symbol", "side", "size", "orderType"]
        }
      },
      
      {
        name: "cancel_order",
        description: "Cancel an existing order",
        inputSchema: {
          type: "object",
          properties: {
            symbol: {
              type: "string",
              description: "Symbol of the order to cancel"
            },
            orderId: {
              type: "string",
              description: "ID of the order to cancel"
            }
          },
          required: ["symbol", "orderId"]
        }
      },
      
      // Strategy management tools
      {
        name: "create_strategy",
        description: "Create a new trading strategy",
        inputSchema: {
          type: "object",
          properties: {
            name: {
              type: "string",
              description: "Name of the strategy"
            },
            description: {
              type: "string",
              description: "Description of the strategy"
            },
            config: {
              type: "object",
              description: "Strategy configuration"
            }
          },
          required: ["name", "description", "config"]
        }
      },
      
      {
        name: "activate_strategy",
        description: "Activate or deactivate a strategy",
        inputSchema: {
          type: "object",
          properties: {
            strategyId: {
              type: "string",
              description: "ID of the strategy to activate/deactivate"
            },
            active: {
              type: "boolean",
              description: "Whether to activate (true) or deactivate (false) the strategy"
            }
          },
          required: ["strategyId", "active"]
        }
      }
    ]
  };
});

/**
 * Handler for tool calls
 * Implements the logic for each tool
 */
server.setRequestHandler(CallToolRequestSchema, async (request) => {
  switch (request.params.name) {
    // Authentication tool
    case "authenticate": {
      const args = request.params.arguments || {};
      const privateKey = args.privateKey as string | undefined;
      const walletAddress = args.walletAddress as string | undefined;
      const testnet = args.testnet !== undefined ? Boolean(args.testnet) : true;
      const vaultAddress = args.vaultAddress as string | undefined;
      
      // Validate inputs
      if (!privateKey && !walletAddress) {
        throw new McpError(
          ErrorCode.InvalidParams,
          "Either privateKey or walletAddress must be provided"
        );
      }
      
      // Validate private key format if provided
      if (privateKey) {
        try {
          const formattedPrivateKey = privateKey.startsWith('0x') ? privateKey : `0x${privateKey}`;
          new ethers.Wallet(formattedPrivateKey);
        } catch (error) {
          throw new McpError(
            ErrorCode.InvalidParams,
            "Invalid private key format"
          );
        }
      }
      
      // Store credentials
      userCredentials.privateKey = privateKey;
      userCredentials.walletAddress = walletAddress;
      userCredentials.testnet = testnet;
      userCredentials.vaultAddress = vaultAddress;
      
      // Initialize client
      hyperliquidClient = initializeClient();
      
      if (!hyperliquidClient) {
        throw new McpError(
          ErrorCode.InternalError,
          "Failed to initialize Hyperliquid client"
        );
      }
      
      return {
        content: [{
          type: "text",
          text: `Successfully authenticated with Hyperliquid ${testnet ? 'testnet' : 'mainnet'}`
        }]
      };
    }
    
    // Market data tool
    case "get_market_data": {
      const args = request.params.arguments || {};
      const symbol = args.symbol as string;
      
      if (!symbol) {
        throw new McpError(
          ErrorCode.InvalidParams,
          "Symbol is required"
        );
      }
      
      if (!hyperliquidClient) {
        hyperliquidClient = initializeClient();
      }
      
      if (!hyperliquidClient) {
        throw new McpError(
          ErrorCode.InvalidRequest,
          "No credentials provided. Please authenticate first."
        );
      }
      
      try {
        await hyperliquidClient.connect();
        
        // Get market data
        const l2Book = await hyperliquidClient.info.getL2Book(symbol);
        
        // Note: These methods might not exist in the current version of the SDK
        // We'll use a simplified approach for now
        const marketData = {
          symbol,
          orderBook: l2Book,
          timestamp: new Date().toISOString()
        };
        
        return {
          content: [{
            type: "text",
            text: JSON.stringify(marketData, null, 2)
          }]
        };
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : String(error);
        throw new McpError(
          ErrorCode.InternalError,
          `Failed to fetch market data: ${errorMessage}`
        );
      }
    }
    
    // Trading tool - Place order
    case "place_order": {
      const args = request.params.arguments || {};
      const symbol = args.symbol as string;
      const side = args.side as 'buy' | 'sell';
      const size = Number(args.size);
      const price = args.price !== undefined ? Number(args.price) : undefined;
      const orderType = args.orderType as 'limit' | 'market';
      const reduceOnly = args.reduceOnly !== undefined ? Boolean(args.reduceOnly) : false;
      
      // Validate inputs
      if (!symbol || !side || !size || !orderType) {
        throw new McpError(
          ErrorCode.InvalidParams,
          "Symbol, side, size, and orderType are required"
        );
      }
      
      if (!hyperliquidClient) {
        hyperliquidClient = initializeClient();
      }
      
      if (!hyperliquidClient) {
        throw new McpError(
          ErrorCode.InvalidRequest,
          "No credentials provided. Please authenticate first."
        );
      }
      
      if (!userCredentials.privateKey) {
        throw new McpError(
          ErrorCode.InvalidRequest,
          "Private key is required for trading operations"
        );
      }
      
      try {
        await hyperliquidClient.connect();
        
        // Prepare order
        const orderRequest: any = {
          coin: symbol,
          is_buy: side === "buy",
          sz: size,
          reduce_only: reduceOnly
        };
        
        // Set order type and price
        if (orderType === "limit") {
          if (!price) {
            throw new McpError(
              ErrorCode.InvalidParams,
              "Price is required for limit orders"
            );
          }
          
          orderRequest.limit_px = price;
          orderRequest.order_type = { limit: { tif: "Gtc" } };
        } else {
          // Market order
          orderRequest.order_type = { market: {} };
        }
        
        // Place order
        const result = await hyperliquidClient.exchange.placeOrder(orderRequest);
        
        return {
          content: [{
            type: "text",
            text: JSON.stringify(result, null, 2)
          }]
        };
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : String(error);
        throw new McpError(
          ErrorCode.InternalError,
          `Failed to place order: ${errorMessage}`
        );
      }
    }
    
    // Trading tool - Cancel order
    case "cancel_order": {
      const args = request.params.arguments || {};
      const symbol = args.symbol as string;
      const orderId = args.orderId as string;
      
      // Validate inputs
      if (!symbol || !orderId) {
        throw new McpError(
          ErrorCode.InvalidParams,
          "Symbol and orderId are required"
        );
      }
      
      if (!hyperliquidClient) {
        hyperliquidClient = initializeClient();
      }
      
      if (!hyperliquidClient) {
        throw new McpError(
          ErrorCode.InvalidRequest,
          "No credentials provided. Please authenticate first."
        );
      }
      
      if (!userCredentials.privateKey) {
        throw new McpError(
          ErrorCode.InvalidRequest,
          "Private key is required for trading operations"
        );
      }
      
      try {
        await hyperliquidClient.connect();
        
        // Cancel order
        const result = await hyperliquidClient.exchange.cancelOrder({
          coin: symbol,
          o: parseInt(orderId, 10)
        });
        
        return {
          content: [{
            type: "text",
            text: JSON.stringify(result, null, 2)
          }]
        };
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : String(error);
        throw new McpError(
          ErrorCode.InternalError,
          `Failed to cancel order: ${errorMessage}`
        );
      }
    }
    
    // Strategy management tool - Create strategy
    case "create_strategy": {
      const args = request.params.arguments || {};
      const name = args.name as string;
      const description = args.description as string;
      const config = args.config as any;
      
      // Validate inputs
      if (!name || !description || !config) {
        throw new McpError(
          ErrorCode.InvalidParams,
          "Name, description, and config are required"
        );
      }
      
      // Generate a unique ID for the strategy
      const id = `strategy-${Date.now()}-${Math.floor(Math.random() * 1000)}`;
      
      // Store the strategy
      strategies[id] = {
        id,
        name,
        description,
        config,
        active: false
      };
      
      return {
        content: [{
          type: "text",
          text: `Created strategy "${name}" with ID: ${id}`
        }]
      };
    }
    
    // Strategy management tool - Activate/deactivate strategy
    case "activate_strategy": {
      const args = request.params.arguments || {};
      const strategyId = args.strategyId as string;
      const active = args.active !== undefined ? Boolean(args.active) : false;
      
      // Validate inputs
      if (!strategyId || active === undefined) {
        throw new McpError(
          ErrorCode.InvalidParams,
          "StrategyId and active status are required"
        );
      }
      
      // Check if strategy exists
      if (!strategies[strategyId]) {
        throw new McpError(
          ErrorCode.InvalidRequest,
          `Strategy ${strategyId} not found`
        );
      }
      
      // Update strategy status
      strategies[strategyId].active = active;
      
      return {
        content: [{
          type: "text",
          text: `Strategy ${strategyId} ${active ? 'activated' : 'deactivated'}`
        }]
      };
    }
    
    default:
      throw new McpError(
        ErrorCode.MethodNotFound,
        `Unknown tool: ${request.params.name}`
      );
  }
});

/**
 * Start the server using stdio transport
 */
async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error("Hyperliquid MCP server running on stdio");
}

main().catch((error) => {
  console.error("Server error:", error);
  process.exit(1);
});