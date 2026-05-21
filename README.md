# DoxaBot for Discord

Christian encouragement and Bible lookup as Discord slash commands. Powered by [Doxa MCP](https://doxa.app/mcp).

Three slash commands:

- `/encourage situation:<text> [movement:<one-of-9>]` — Doxa-voice encouragement for what you're facing
- `/scripture reference:<text>` — Bible verse lookup (Berean Standard Bible)
- `/doxaway [movement:<one-of-9>]` — The 9-movement Doxa Way framework

Built on `@thedoxaway/mcp-client`, runs anywhere Node 20+ runs (Fly.io, Railway, Render, bare metal).

## First-time setup

### 1. Create a Discord application

1. Go to <https://discord.com/developers/applications> and click **New Application**
2. Name it "DoxaBot" (or whatever fits your server)
3. In the left sidebar, click **Bot**
4. Click **Reset Token** and copy it — this is your `DISCORD_BOT_TOKEN`
5. Under **Privileged Gateway Intents**, keep all OFF (the bot only needs slash commands, no message content)
6. Save changes
7. From the **General Information** page, copy the **Application ID** — this is your `DISCORD_CLIENT_ID`

### 2. Add the bot to a server

1. In your Discord application, click **OAuth2** > **URL Generator**
2. Under **Scopes**, select `bot` and `applications.commands`
3. Under **Bot Permissions**, select `Send Messages` and `Embed Links`
4. Copy the generated URL, open it in a browser, and add the bot to your server

### 3. Configure environment

```bash
cp .env.example .env
# Edit .env and fill in DISCORD_BOT_TOKEN + DISCORD_CLIENT_ID
# Optional: set DISCORD_GUILD_ID to your test server for instant command updates during dev
# Optional: set ANTHROPIC_API_KEY for BYOL mode (unlimited calls)
```

### 4. Install dependencies + register commands

```bash
npm install
npm run deploy-commands
```

You should see `✓ Registered 3 guild command(s)` (or global). With `DISCORD_GUILD_ID` set, commands appear in your test guild immediately. Without it, global commands take up to 1 hour to propagate.

### 5. Run the bot

```bash
npm run dev    # Watch mode with native TypeScript (Node 20+)
# OR
npm run build && npm start    # Production
```

## Deploying to Fly.io

```bash
# One-time setup
flyctl launch --no-deploy --copy-config --name doxa-discord-bot
flyctl secrets set \
  DISCORD_BOT_TOKEN="..." \
  DISCORD_CLIENT_ID="..." \
  ANTHROPIC_API_KEY="..."  # optional, for BYOL

# Deploy
flyctl deploy

# Logs
flyctl logs
```

Fly.io's smallest shared-cpu-1x machine ($1.94/mo) handles the bot easily — Discord bots are I/O-bound on a single persistent WebSocket.

## Cost model

The bot itself runs ~$2/mo on Fly.io.

For LLM costs:

- **Default (no `ANTHROPIC_API_KEY`)** — uses Doxa MCP's free anon tier (50 calls/day per source IP). Fine for low-traffic servers but you'll hit the cap on busy ones.
- **With `ANTHROPIC_API_KEY` set** — BYOL mode. The bot passes your key to Doxa MCP for each call, and Anthropic bills you directly. Unlimited calls, 1500-token cap per response. Roughly $0.005-0.015 per `/encourage`. `/scripture` and `/doxaway` are essentially free either way (no LLM involved).

## Architecture

```
Discord user
   │
   │ slash command
   ▼
DoxaBot (this repo, deployed on Fly.io)
   │
   │ @thedoxaway/mcp-client
   ▼
Doxa MCP (doxa.app/mcp/v1)
   │
   │ Claude Sonnet 4.6 + 141 KB Doxa voice prompt + Bible API
   ▼
Response: text + Scripture refs + Doxa-way movement
```

The bot is a thin shim. All voice, theology, and edge-case handling live in the hosted MCP. If we update the Doxa voice, this bot inherits it automatically.

## Useful Discord commands during setup

```bash
# Verify token works
curl -s -H "Authorization: Bot $DISCORD_BOT_TOKEN" \
  https://discord.com/api/v10/users/@me | jq

# List current registered commands
curl -s -H "Authorization: Bot $DISCORD_BOT_TOKEN" \
  https://discord.com/api/v10/applications/$DISCORD_CLIENT_ID/commands | jq
```

## License

MIT. The hosted Doxa MCP server, the voice prompt, and the name "The Doxa Way" are © Doxa.
