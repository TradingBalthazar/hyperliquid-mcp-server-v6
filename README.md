# Hyperliquid MCP Server v6

This is an MCP (Model Context Protocol) server for interacting with the Hyperliquid exchange API. It allows users to:

- Authenticate with their Hyperliquid credentials
- Execute trades on the Hyperliquid exchange
- Create and run custom trading strategies
- Monitor their account and positions

## Features

- Full integration with Hyperliquid API
- Support for both spot and perpetual markets
- Real-time price data
- Account information and position management
- Order placement and cancellation
- Strategy creation and management

## Installation

1. Clone this repository:
```bash
git clone https://github.com/TradingBalthazar/hyperliquid-mcp-server-v6.git
```

2. Install dependencies:
```bash
cd hyperliquid-mcp-server-v6
npm install
```

3. Build the server:
```bash
npm run build
```

4. Run the server:
```bash
node build/index.js
```

## Usage

This MCP server can be used with any MCP-compatible client. To use it with a Next.js application, add the following to your `mcp-config.json` file:

```json
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
```

## License

MIT