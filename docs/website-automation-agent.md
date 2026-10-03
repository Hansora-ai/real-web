# Website chat using the existing Hansora Automation agent

The website's Ask Hansora AI chat can use the ElevenLabs agent already associated with Hansora ARM / Hansora AI. The server resolves its active provider resource using business ID `14aeca3a-d3b4-4d9a-b876-e23954dd1826`. A visitor cannot select another tenant or agent.

The saved Automation knowledge, personality, language settings and underlying model remain the source of the assistant's behavior. Each website visitor retains their own existing website session and history. Instagram history is not merged with website history. Agent replies may vary in wording across channels.

## Activation later (not performed)

After review, apply the code and set server environment variables:

- `SALES_AGENT_ENABLED=true` (existing website chat flag)
- `SALES_AGENT_PROVIDER=elevenlabs`
- `SALES_AGENT_AUTOMATION_BUSINESS_ID=14aeca3a-d3b4-4d9a-b876-e23954dd1826` (also the default)
- Existing `ELEVENLABS_API_KEY`, `SUPABASE_URL`, and Supabase service-role configuration must be available to the backend. Never put keys in browser code.
- `HANSORA_AUTOMATION_PROVIDER` must remain `elevenlabs` or unset.

Do not hard-code an ElevenLabs resource ID from a screenshot: the existing database mapping is authoritative. The business must have a saved agent and an active ElevenLabs provider-resource row; otherwise website requests return a configuration error.

The next shared-agent synchronization adds the catalog/account tool definitions and channel-specific response rules to this business's existing agent. Synchronization can occur on the next website request or Automation message/save after activation. It does not replace its uploaded knowledge or its saved personality. Only the selected support business receives these tools. This changes its shared agent tool configuration, so validate it in a non-production business/agent before production activation if needed. No provider synchronization was run while preparing this patch.

## Behavior and account boundaries

The old chat interface, login/session handling, rate limits, replay handling, message storage, memory and navigation buttons remain in place. The ElevenLabs adapter uses only this visitor's prior website conversation as context, with bounded text. It does not inject the old sales playbook into the shared agent's prompt.

The existing model/features catalog, model quotation, package and account tools are shared. Account lookups on the website are executed with the authenticated server-side website user. Model arguments cannot choose an account. Anonymous visitors receive login_required. Instagram, WhatsApp and test chats do not acquire an authenticated Creative account from this integration; their account-tool calls also return login_required, even when the business owner is logged in. Secure cross-channel account linking is separate work.

Website responses may use submit_sales_reply to preserve existing model/pricing/course/login/support buttons. Plain-text answers from the same agent are also supported, with no fabricated recommendations or buttons. Invalid structured replies are rejected. Instagram and other Automation channels continue ordinary text replies and their existing workflow actions. Website booking, ordering, lead creation and Automation handoff actions are not enabled by this patch. The existing contact_support website action is navigation, not a staff notification or Automation inbox handoff.

Website conversations remain in the existing website chat tables, not the Automation inbox. Website calls use the existing website rate limiting and usage logging. They incur ElevenLabs provider usage but do not debit visitors or the business through Automation's per-message billing functions. Token counts are unavailable through the current ElevenLabs socket result: compatibility log fields remain zero and estimated provider cost is null. Provider is logged as elevenlabs; no GPT token-cost estimate is applied.

The model configured on the shared ElevenLabs agent is used; SALES_AGENT_MODEL does not choose the ElevenLabs model. Existing code's ELEVENLABS_AGENT_LLM controls model synchronization. Choosing Kie/OpenAI explicitly retains the previous website generation path; ElevenLabs errors never silently switch providers. Switching away from ElevenLabs does not immediately remove registered tools from the provider: the next business synchronization reconciles the tools.

## Verification

Run `npm run test:sales-agent` and `npm run test:automation`.

Tests cover server-scoped agent resolution, visitor-specific context, current-message deduplication, authenticated website tool dispatch, public-channel account isolation, other-business isolation, website buttons, plain-text fallback, failed agent resolution/synchronization, invalid structured responses, and terminal tool responses without extra agent text.

After an authorized deployment, verify the same product question in Instagram and the website, an anonymous balance question, a signed-in balance question, Armenian/Russian/English messages, navigation buttons, and an unavailable-agent case. Compare facts and behavior rather than identical wording. Live provider responses and real account data were not exercised locally.

## Rollback

Select the previous SALES_AGENT_PROVIDER (`kie` or `openai`) in server configuration. The old provider path is retained. A rollback is a deployment/configuration operation; none was performed during implementation.
