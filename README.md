# DoxaBot for Discord

[![Add DoxaBot](https://img.shields.io/badge/Add%20to%20Discord-5865F2?style=for-the-badge&logo=discord&logoColor=white)](https://discord.com/oauth2/authorize?client_id=1507038958318518352&permissions=2048&scope=bot+applications.commands)
[![Top.gg](https://img.shields.io/badge/Top.gg-FF3366?style=for-the-badge&logo=top.gg&logoColor=white)](https://top.gg/bot/1507038958318518352)
[![Doxa](https://img.shields.io/badge/doxa.app-FF4500?style=for-the-badge)](https://doxa.app?utm_source=github&utm_medium=readme)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg?style=for-the-badge)](https://opensource.org/licenses/MIT)

Encouragement for your whole journey. Scripture-anchored encouragement and Bible lookup as Discord slash commands, powered by [Doxa MCP](https://doxa.app/mcp).

---

## Commands

| Command | What it does |
|---------|-------------|
| `/encourage situation:<text> [movement:<1-of-9>]` | Encouragement grounded in Scripture for what you are facing right now |
| `/scripture reference:<text>` | Bible verse lookup (Berean Standard Bible) |
| `/doxaway [movement:<1-of-9>]` | Explore The Doxa Way, a 9-movement framework for walking with God |
| `/weigh word:<text>` | Test a word, impression, or advice against Scripture (1 Thess 5:20-21) |
| `/promise area:<text>` | A Scripture promise to stand on for an area of life (autocomplete suggests areas) |
| `/privacy` | Withdraw consent and delete the messages Doxa stored from you |

## Privacy and consent

What you send DoxaBot can show your religious beliefs (special-category data under UK/EU GDPR Art. 9). Before `/encourage`, `/weigh`, `/promise`, `/scripture` or an @mention sends your text anywhere, DoxaBot shows a short notice with an **I agree** button. Until you press it, your text is not sent or stored. `/privacy` withdraws at any time and deletes the messages Doxa stored from you. Privacy policy: <https://doxa.app/privacy#special-category>

Consent is stored in the Doxa database. The bot connects as the `discord_bot` Postgres role, which can only run three functions (status, grant, withdraw) and cannot read any table.

### Interactive Features

- **Autocomplete** on `/promise area:` suggests 16 common life areas as you type
- **Link buttons** on encouragement replies take you straight to the Doxa app
- **Slash command choices** on `/encourage` and `/doxaway` let you pick from the 9 Doxa Way movements

## The Doxa Way

A 9-movement framework for engaging with what God says:

**Hear** > **Discern** > **Test** > **Record** > **Remember** > **Engage** > **Trust** > **Fight** > **Endure**

Daily practice (5 verbs): Hear, Discern, Record, Remember, Trust.

## How it works

```
Discord user
   |
   | slash command
   v
DoxaBot (this repo, deployed on Fly.io)
   |
   | @thedoxaway/mcp-client
   v
Doxa MCP (doxa.app/mcp/v1)
   |
   | Claude + 141 KB Doxa voice prompt + Bible API
   v
Response: text + Scripture refs + Doxa Way movement
```

The bot is a thin shim. All voice, theology, and Scripture handling live in the hosted Doxa MCP. When we update the Doxa voice, every bot inherits it automatically.

## Cost

The bot itself runs ~$2/mo on Fly.io.

| Mode | How it works | Limit |
|------|-------------|-------|
| **Free (default)** | Uses Doxa MCP's free anon tier | 50 calls/day per source IP |
| **BYOL** | Set `ANTHROPIC_API_KEY` to use your own key | Unlimited, ~$0.005-0.015 per `/encourage` |

`/scripture` and `/doxaway` are essentially free either way (no LLM involved).

## Self-hosting

### 1. Create a Discord application

1. Go to <https://discord.com/developers/applications> and click **New Application**
2. Name it "DoxaBot" (or whatever fits your server)
3. In the left sidebar, click **Bot**
4. Click **Reset Token** and copy it as your `DISCORD_BOT_TOKEN`
5. Under **Privileged Gateway Intents**, keep all OFF (the bot only needs slash commands)
6. From the **General Information** page, copy the **Application ID** as your `DISCORD_CLIENT_ID`

### 2. Add the bot to a server

1. In your Discord application, click **OAuth2** > **URL Generator**
2. Under **Scopes**, select `bot` and `applications.commands`
3. Under **Bot Permissions**, select `Send Messages` and `Embed Links`
4. Copy the generated URL, open it, and add the bot to your server

### 3. Configure environment

```bash
cp .env.example .env
# Edit .env: fill in DISCORD_BOT_TOKEN + DISCORD_CLIENT_ID
# Optional: DISCORD_GUILD_ID for instant dev-guild command updates
# Optional: ANTHROPIC_API_KEY for BYOL mode (unlimited)
# Required: DATABASE_URL for consent storage (the bot will not start without it)
```

### 4. Install and run

```bash
npm install
npm run dev    # Watch mode (Node 20+)
# OR
npm run build && npm start    # Production
```

Commands self-register on boot. Global commands take up to 1 hour to propagate; set `DISCORD_GUILD_ID` for instant guild-scoped updates during development.

### 5. Deploy to Fly.io

```bash
flyctl launch --no-deploy --copy-config --name doxa-discord-bot
flyctl secrets set DISCORD_BOT_TOKEN="..." DISCORD_CLIENT_ID="..."
# Doxa's own deploy: the discord_bot pooler URL lives in the macOS Keychain
flyctl secrets set DATABASE_URL="$(security find-generic-password -s 'doxa-discord-bot DATABASE_URL' -w)" --stage
flyctl deploy
```

## Useful commands during setup

```bash
# Verify token works
curl -s -H "Authorization: Bot $DISCORD_BOT_TOKEN" \
  https://discord.com/api/v10/users/@me | jq

# List registered commands
curl -s -H "Authorization: Bot $DISCORD_BOT_TOKEN" \
  https://discord.com/api/v10/applications/$DISCORD_CLIENT_ID/commands | jq
```

## Links

- [Doxa App](https://doxa.app) - Encouragement for your whole journey
- [Doxa MCP](https://doxa.app/mcp) - The API behind this bot
- [The Doxa Way](https://doxa.app/the-doxa-way) - The 9-movement framework

## License

MIT. The hosted Doxa MCP server, the voice prompt, and the name "The Doxa Way" are (c) Doxa.
