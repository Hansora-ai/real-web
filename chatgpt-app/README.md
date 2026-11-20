# Hansora Automation ChatGPT app package

Upload `hansora-automation.zip` at https://platform.openai.com/plugins ("Upload new or existing plugin").
The server it points to is `https://hansora.co/automation/app/mcp` (an address of its own: OpenAI lets each address belong to one app; the developer-mode connector uses `/automation/v2/mcp`) (netlify/functions/automation-mcp.mjs).

Before submitting, replace `REPLACE_WITH_DEMO_VIDEO_LINK` in `hansora-automation/plugin.json` with the demo video link and rebuild the ZIP:

    cd chatgpt-app/hansora-automation && zip -r -X ../hansora-automation.zip plugin.json mcp.json assets

The review test cases use the demo account's AI employee "Demo Bakery".
