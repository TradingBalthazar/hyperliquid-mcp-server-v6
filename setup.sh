#!/bin/bash

# Hyperliquid MCP Server v6 Setup Script
# This script automates the entire setup process for the Hyperliquid MCP Server
# and ensures all files are created in the correct locations

echo "Starting Hyperliquid MCP Server v6 Setup..."

# Get the absolute path of the main project directory
MAIN_PROJECT_DIR=$(cd .. && pwd)
echo "Main project directory: $MAIN_PROJECT_DIR"

# Step 1: Install dependencies and build the MCP server
echo "Installing dependencies for MCP server..."
npm install
echo "Building MCP server..."
npm run build

# Step 2: Install the Hyperliquid package in the main Next.js project
echo "Installing Hyperliquid package in the main Next.js project..."
cd "$MAIN_PROJECT_DIR"
npm install hyperliquid
cd -

# Step 3: Create the MCP configuration in the main project directory
echo "Creating MCP configuration in the main project directory..."
cat > "$MAIN_PROJECT_DIR/mcp-config.json" << 'EOL'
{
  "mcpServers": {
    "hyperliquid": {
      "command": "node",
      "args": ["$(pwd)/hyperliquid-mcp-server-v6/build/index.js"],
      "disabled": false,
      "alwaysAllow": []
    }
  }
}
EOL

# Step 4: Create the API endpoint in the main project
echo "Creating API endpoint in the main project..."
mkdir -p "$MAIN_PROJECT_DIR/src/pages/api"
cat > "$MAIN_PROJECT_DIR/src/pages/api/hyperliquid.ts" << 'EOL'
import type { NextApiRequest, NextApiResponse } from 'next'
import { Hyperliquid } from 'hyperliquid'

type AuthData = {
  privateKey?: string
  walletAddress?: string
  testnet: boolean
  vaultAddress?: string
}

type ResponseData = {
  success: boolean
  data?: any
  error?: string
}

// Store client in memory (not secure for production)
let hyperliquidClient: Hyperliquid | null = null

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse<ResponseData>
) {
  if (req.method !== 'POST') {
    return res.status(405).json({ success: false, error: 'Method not allowed' })
  }

  const { action, params } = req.body

  try {
    switch (action) {
      case 'authenticate':
        return await handleAuthenticate(params, res)
      case 'getAccountInfo':
        return await handleGetAccountInfo(res)
      default:
        return res.status(400).json({ success: false, error: 'Invalid action' })
    }
  } catch (error) {
    console.error('API error:', error)
    return res.status(500).json({ 
      success: false, 
      error: error instanceof Error ? error.message : 'Unknown error' 
    })
  }
}

async function handleAuthenticate(params: AuthData, res: NextApiResponse<ResponseData>) {
  try {
    const { privateKey, walletAddress, testnet = true, vaultAddress } = params

    if (!privateKey && !walletAddress) {
      return res.status(400).json({
        success: false,
        error: 'Either privateKey or walletAddress must be provided'
      })
    }

    // Initialize client
    hyperliquidClient = new Hyperliquid({
      privateKey,
      testnet,
      walletAddress,
      vaultAddress,
      enableWs: true
    })

    await hyperliquidClient.connect()

    return res.status(200).json({
      success: true,
      data: {
        message: `Successfully authenticated with Hyperliquid ${testnet ? 'testnet' : 'mainnet'}`
      }
    })
  } catch (error) {
    console.error('Authentication error:', error)
    return res.status(500).json({
      success: false,
      error: error instanceof Error ? error.message : 'Authentication failed'
    })
  }
}

async function handleGetAccountInfo(res: NextApiResponse<ResponseData>) {
  if (!hyperliquidClient) {
    return res.status(401).json({
      success: false,
      error: 'Not authenticated. Please authenticate first.'
    })
  }

  try {
    const walletAddress = hyperliquidClient['walletAddress'] || 
                         (hyperliquidClient['wallet'] ? 
                          await hyperliquidClient['wallet'].getAddress() : 
                          null)

    if (!walletAddress) {
      return res.status(400).json({
        success: false,
        error: 'No wallet address available'
      })
    }

    // Get account information
    let accountInfo: any = {
      network: hyperliquidClient['testnet'] ? 'testnet' : 'mainnet',
      walletAddress
    }

    // Get clearinghouse state for perpetuals
    try {
      const perpState = await hyperliquidClient.info.perpetuals.getClearinghouseState(walletAddress)
      accountInfo.perpetuals = perpState
    } catch (error) {
      console.error('Error fetching perpetuals data:', error)
      accountInfo.perpetuals = { error: 'Failed to fetch perpetuals data' }
    }

    // Get spot clearinghouse state if available
    try {
      const spotState = await hyperliquidClient.info.spot.getSpotClearinghouseState(walletAddress)
      
      // Get spot meta and asset contexts to get price information
      const [spotMeta, spotAssetCtxs] = await hyperliquidClient.info.spot.getSpotMetaAndAssetCtxs()
      
      console.log("Spot Asset Contexts:", JSON.stringify(spotAssetCtxs, null, 2))
      
      // Create a map of coin to price
      const priceMap: { [key: string]: number } = {}
      spotAssetCtxs.forEach((assetCtx: any) => {
        priceMap[assetCtx.coin] = parseFloat(assetCtx.markPx)
      })
      
      // Ensure USDC has a price of 1
      if (!priceMap["USDC-SPOT"] || priceMap["USDC-SPOT"] === 0) {
        priceMap["USDC-SPOT"] = 1.0
      }
      
      console.log("Price Map:", priceMap)
      
      // Format spot data for easier consumption by the frontend
      if (spotState && spotState.balances) {
        // Transform the balances array to include proper formatting and USD value
        const formattedBalances = spotState.balances.map((balance: any) => {
          const tokenAmount = parseFloat(balance.total)
          const price = priceMap[balance.coin] || 0
          const usdValue = tokenAmount * price
          
          console.log(`Balance for ${balance.coin}: Amount=${tokenAmount}, Price=${price}, USD Value=${usdValue}`)
          
          return {
            coin: balance.coin,
            token: balance.token, // Token ID
            total: balance.total, // Number of tokens
            hold: balance.hold,
            entryNtl: balance.entryNtl,
            price: price.toString(), // Current price
            usdValue: usdValue.toString() // Calculated USD value
          }
        })
        
        accountInfo.spot = {
          ...spotState,
          balances: formattedBalances
        }
      } else {
        accountInfo.spot = spotState
      }
    } catch (error) {
      console.error('Error fetching spot data:', error)
      accountInfo.spot = { error: 'Failed to fetch spot data' }
    }

    return res.status(200).json({
      success: true,
      data: accountInfo
    })
  } catch (error) {
    console.error('Error fetching account info:', error)
    return res.status(500).json({
      success: false,
      error: error instanceof Error ? error.message : 'Failed to fetch account information'
    })
  }
}
EOL

# Step 5: Update the index page in the main project
echo "Updating index page in the main project..."
cat > "$MAIN_PROJECT_DIR/src/pages/index.tsx" << 'EOL'
import { useState } from "react"
import localFont from "next/font/local"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Switch } from "@/components/ui/switch"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { useToast } from "@/hooks/use-toast"

const geistSans = localFont({
  src: "./fonts/GeistVF.woff",
  variable: "--font-geist-sans",
  weight: "100 900",
})
const geistMono = localFont({
  src: "./fonts/GeistMonoVF.woff",
  variable: "--font-geist-mono",
  weight: "100 900",
})

export default function Home() {
  const { toast } = useToast()
  const [isLoading, setIsLoading] = useState(false)
  const [isConnected, setIsConnected] = useState(false)
  const [credentials, setCredentials] = useState({
    privateKey: "",
    walletAddress: "",
    testnet: true,
    vaultAddress: ""
  })
  const [accountInfo, setAccountInfo] = useState<any>(null)
  const [totalValue, setTotalValue] = useState<number>(0)

  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const { name, value } = e.target
    setCredentials(prev => ({ ...prev, [name]: value }))
  }

  const handleSwitchChange = (checked: boolean) => {
    setCredentials(prev => ({ ...prev, testnet: checked }))
  }

  const handleConnect = async () => {
    if (!credentials.privateKey && !credentials.walletAddress) {
      toast({
        title: "Error",
        description: "Either Private Key or Wallet Address is required",
        variant: "destructive"
      })
      return
    }

    setIsLoading(true)
    try {
      const response = await fetch('/api/hyperliquid', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          action: 'authenticate',
          params: credentials
        }),
      })

      const result = await response.json()

      if (result.success) {
        toast({
          title: "Connected",
          description: result.data.message,
        })
        setIsConnected(true)
        fetchAccountInfo()
      } else {
        toast({
          title: "Connection Failed",
          description: result.error,
          variant: "destructive"
        })
      }
    } catch (error) {
      toast({
        title: "Connection Error",
        description: error instanceof Error ? error.message : "Failed to connect",
        variant: "destructive"
      })
    } finally {
      setIsLoading(false)
    }
  }

  const calculateTotalValue = (accountData: any) => {
    let total = 0;
    
    // Add perpetuals account value if available
    if (accountData.perpetuals && accountData.perpetuals.marginSummary) {
      total += Number(accountData.perpetuals.marginSummary.accountValue) || 0;
    }
    
    // Add spot balances if available
    if (accountData.spot && accountData.spot.balances) {
      accountData.spot.balances.forEach((balance: any) => {
        // Add the USD value of each spot asset
        total += Number(balance.usdValue) || 0;
      });
    }
    
    return total;
  }

  const fetchAccountInfo = async () => {
    setIsLoading(true)
    try {
      const response = await fetch('/api/hyperliquid', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          action: 'getAccountInfo'
        }),
      })

      const result = await response.json()

      if (result.success) {
        setAccountInfo(result.data)
        const total = calculateTotalValue(result.data);
        setTotalValue(total);
      } else {
        toast({
          title: "Error",
          description: result.error,
          variant: "destructive"
        })
      }
    } catch (error) {
      toast({
        title: "Error",
        description: error instanceof Error ? error.message : "Failed to fetch account info",
        variant: "destructive"
      })
    } finally {
      setIsLoading(false)
    }
  }

  const formatCurrency = (value: number) => {
    return new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency: 'USD',
      minimumFractionDigits: 0,
      maximumFractionDigits: 0
    }).format(value)
  }
  
  const formatPrice = (value: number) => {
    return new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency: 'USD',
      minimumFractionDigits: 2,
      maximumFractionDigits: 2
    }).format(value)
  }

  return (
    <div className={`${geistSans.variable} ${geistMono.variable} font-[family-name:var(--font-geist-sans)]`}>
      <div className="container mx-auto py-10">
        <h1 className="text-3xl font-bold mb-8 text-center">Hyperliquid Dashboard</h1>
        
        <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
          <Card>
            <CardHeader>
              <CardTitle>Connect to Hyperliquid</CardTitle>
              <CardDescription>
                Enter your credentials to connect to the Hyperliquid exchange
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="privateKey">Private Key (optional if Wallet Address is provided)</Label>
                <Input
                  id="privateKey"
                  name="privateKey"
                  type="password"
                  placeholder="Your private key"
                  value={credentials.privateKey}
                  onChange={handleInputChange}
                />
              </div>
              
              <div className="space-y-2">
                <Label htmlFor="walletAddress">Wallet Address (optional if Private Key is provided)</Label>
                <Input
                  id="walletAddress"
                  name="walletAddress"
                  placeholder="Your wallet address"
                  value={credentials.walletAddress}
                  onChange={handleInputChange}
                />
              </div>
              
              <div className="space-y-2">
                <Label htmlFor="vaultAddress">Vault Address (optional)</Label>
                <Input
                  id="vaultAddress"
                  name="vaultAddress"
                  placeholder="Your vault address"
                  value={credentials.vaultAddress}
                  onChange={handleInputChange}
                />
              </div>
              
              <div className="flex items-center space-x-2">
                <Switch
                  id="testnet"
                  checked={credentials.testnet}
                  onCheckedChange={handleSwitchChange}
                />
                <Label htmlFor="testnet">Use Testnet</Label>
              </div>
            </CardContent>
            <CardFooter>
              <Button 
                onClick={handleConnect} 
                disabled={isLoading || (!credentials.privateKey && !credentials.walletAddress)}
                className="w-full"
              >
                {isLoading ? "Connecting..." : isConnected ? "Reconnect" : "Connect"}
              </Button>
            </CardFooter>
          </Card>

          {isConnected && (
            <Card>
              <CardHeader>
                <CardTitle>Account Information</CardTitle>
                <CardDescription>
                  Your Hyperliquid account details
                </CardDescription>
              </CardHeader>
              <CardContent>
                {accountInfo ? (
                  <Tabs defaultValue="summary">
                    <TabsList className="grid w-full grid-cols-3">
                      <TabsTrigger value="summary">Summary</TabsTrigger>
                      <TabsTrigger value="perpetuals">Perpetuals</TabsTrigger>
                      <TabsTrigger value="spot">Spot</TabsTrigger>
                    </TabsList>
                    
                    <TabsContent value="summary" className="space-y-4 mt-4">
                      <div className="grid grid-cols-2 gap-4">
                        <div>
                          <p className="text-sm font-medium">Network</p>
                          <p className="text-lg">{accountInfo.network}</p>
                        </div>
                        <div>
                          <p className="text-sm font-medium">Wallet Address</p>
                          <p className="text-lg truncate">{accountInfo.walletAddress}</p>
                        </div>
                      </div>
                      
                      <div className="mt-4">
                        <p className="text-sm font-medium">Total Account Value (Perp + Spot)</p>
                        <p className="text-2xl font-bold">
                          {formatCurrency(totalValue)}
                        </p>
                      </div>

                      {accountInfo.perpetuals && accountInfo.perpetuals.marginSummary && (
                        <div className="mt-4">
                          <p className="text-sm font-medium">Perpetuals Account Value</p>
                          <p className="text-xl">
                            {formatCurrency(Number(accountInfo.perpetuals.marginSummary.accountValue))}
                          </p>
                        </div>
                      )}

                      {accountInfo.spot && accountInfo.spot.balances && (
                        <div className="mt-4">
                          <p className="text-sm font-medium">Spot Account Value</p>
                          <p className="text-xl">
                            {formatCurrency(totalValue - (accountInfo.perpetuals?.marginSummary?.accountValue || 0))}
                          </p>
                        </div>
                      )}
                      
                      <Button onClick={fetchAccountInfo} variant="outline" className="w-full">
                        Refresh
                      </Button>
                    </TabsContent>
                    
                    <TabsContent value="perpetuals" className="space-y-4 mt-4">
                      {accountInfo.perpetuals && accountInfo.perpetuals.marginSummary ? (
                        <div className="space-y-4">
                          <div className="grid grid-cols-2 gap-4">
                            <div>
                              <p className="text-sm font-medium">Account Value</p>
                              <p className="text-lg">{formatCurrency(Number(accountInfo.perpetuals.marginSummary.accountValue))}</p>
                            </div>
                            <div>
                              <p className="text-sm font-medium">Total Initial Margin</p>
                              <p className="text-lg">{formatCurrency(Number(accountInfo.perpetuals.marginSummary.totalInitialMargin))}</p>
                            </div>
                            <div>
                              <p className="text-sm font-medium">Total Maintenance Margin</p>
                              <p className="text-lg">{formatCurrency(Number(accountInfo.perpetuals.marginSummary.totalMaintenanceMargin))}</p>
                            </div>
                            <div>
                              <p className="text-sm font-medium">Total Position Value</p>
                              <p className="text-lg">{formatCurrency(Number(accountInfo.perpetuals.marginSummary.totalPositionValue))}</p>
                            </div>
                          </div>
                          
                          {accountInfo.perpetuals.assetPositions && accountInfo.perpetuals.assetPositions.length > 0 && (
                            <div className="mt-4">
                              <p className="text-sm font-medium mb-2">Positions</p>
                              <div className="border rounded-md">
                                <div className="grid grid-cols-4 gap-2 p-2 border-b bg-muted/50 font-medium text-sm">
                                  <div>Asset</div>
                                  <div>Size</div>
                                  <div>Entry Price</div>
                                  <div>Unrealized PnL</div>
                                </div>
                                {accountInfo.perpetuals.assetPositions.map((position: any, index: number) => (
                                  <div key={index} className="grid grid-cols-4 gap-2 p-2 border-b last:border-0 text-sm">
                                    <div>{position.coin}</div>
                                    <div>{position.szi}</div>
                                    <div>{position.entryPx}</div>
                                    <div className={position.unrealizedPnl >= 0 ? "text-green-500" : "text-red-500"}>
                                      {formatCurrency(Number(position.unrealizedPnl))}
                                    </div>
                                  </div>
                                ))}
                              </div>
                            </div>
                          )}
                        </div>
                      ) : (
                        <p>No perpetuals data available</p>
                      )}
                    </TabsContent>
                    
                    <TabsContent value="spot" className="space-y-4 mt-4">
                      {accountInfo.spot && accountInfo.spot.balances && accountInfo.spot.balances.length > 0 ? (
                        <div className="space-y-4">
                          <p className="text-sm font-medium mb-2">Spot Balances</p>
                          <div className="border rounded-md">
                            <div className="grid grid-cols-4 gap-2 p-2 border-b bg-muted/50 font-medium text-sm">
                              <div>Asset</div>
                              <div>Tokens</div>
                              <div>USD Value</div>
                              <div>Price</div>
                            </div>
                            {accountInfo.spot.balances.map((balance: any, index: number) => (
                              <div key={index} className="grid grid-cols-4 gap-2 p-2 border-b last:border-0 text-sm">
                                <div>{balance.coin}</div>
                                <div>{parseFloat(balance.total).toFixed(2)}</div>
                                <div>{formatCurrency(Number(balance.usdValue))}</div>
                                <div>{formatPrice(Number(balance.price))}</div>
                              </div>
                            ))}
                          </div>
                          
                          <div className="mt-4">
                            <p className="text-sm font-medium">Total Spot Value</p>
                            <p className="text-xl font-bold">
                              {formatCurrency(totalValue - (accountInfo.perpetuals?.marginSummary?.accountValue || 0))}
                            </p>
                          </div>
                        </div>
                      ) : (
                        <p>No spot data available</p>
                      )}
                    </TabsContent>
                  </Tabs>
                ) : (
                  <div className="flex justify-center items-center h-40">
                    <p>Loading account information...</p>
                  </div>
                )}
              </CardContent>
            </Card>
          )}
        </div>
      </div>
    </div>
  )
}
EOL

# Step 6: Create a one-line setup command file
echo "Creating one-line setup command..."
cat > one-line-setup.txt << 'EOL'
git clone https://github.com/TradingBalthazar/hyperliquid-mcp-server-v6.git && cd hyperliquid-mcp-server-v6 && ./setup.sh && cd ..
EOL

# Make the setup script executable
chmod +x setup.sh

# Start the MCP server
echo "Setup complete! The Hyperliquid MCP Server and dashboard are now ready to use."
echo "You can access the dashboard at http://localhost:3000"
echo ""
echo "To start the MCP server, run: node build/index.js"