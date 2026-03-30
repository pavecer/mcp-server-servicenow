# MCS ServiceNow Ordering Runbook

This runbook describes how to configure Microsoft Copilot Studio to render ServiceNow Adaptive Cards and submit orders through this MCP server.

## Scope

Use this runbook for the flow:
1. infer order intent,
2. search accessible ServiceNow catalog items,
3. render item selection card,
4. render item order form card,
5. submit order,
6. return order confirmation card.

## Prerequisites

- MCP server deployed and reachable.
- MCP tool connection established in Copilot Studio.
- OAuth setup completed (see root setup docs).
- Tools available:
  - `search_catalog_items`
  - `get_catalog_item_form`
  - `place_order`

## Artifacts in this repo

- Topic blueprint YAML: [copilot-studio/topics/servicenow-ordering.topics.yaml](copilot-studio/topics/servicenow-ordering.topics.yaml)
- Action contracts: [docs/MCS_ACTION_CONTRACTS.md](docs/MCS_ACTION_CONTRACTS.md)

## Step 1: Add MCP Tool In Copilot Studio

1. Open your Copilot Studio agent.
2. Go to Tools.
3. Add tool > Model Context Protocol.
4. Provide MCP endpoint URL (`/mcp`).
5. Authenticate using OAuth 2.0 dynamic discovery.
6. Verify all three tools appear in tool list.

## Step 2: Create Topic Set

Create five topics using the blueprint in [copilot-studio/topics/servicenow-ordering.topics.yaml](copilot-studio/topics/servicenow-ordering.topics.yaml):

1. `SN-01-IntentAndSearch`
2. `SN-02-SelectCatalogItem`
3. `SN-03-RenderOrderFormCard`
4. `SN-04-SubmitOrder`
5. `SN-05-FallbackQuestionFlow`

Note: if direct YAML import is not available in your environment, create topics manually and copy node logic from the YAML.

## Step 3: Configure Topic Variables

At minimum define:
- `itemSearchResultsJson`
- `itemSelectionCardJson`
- `selectedItemSysId`
- `itemFormCardJson`
- `formSubmitPayloadJson`
- `orderResultJson`
- `correlationId`
- `operationStatus`
- `operationError`

## Step 4: Implement Intent + Search Topic

In `SN-01-IntentAndSearch`:
1. Start on phrase trigger or handoff from global intent router.
2. Generate correlation ID.
3. Call `search_catalog_items` with query from user prompt.
4. Save `tool.content[0].text` to `itemSearchResultsJson`.
5. Parse JSON.
6. Branch:
   - `found = 0` -> ask user to refine search.
   - otherwise -> store `selectionAdaptiveCard` as JSON string and handoff to selection topic.

## Step 5: Implement Selection Topic

In `SN-02-SelectCatalogItem`:
1. Send adaptive card from `itemSelectionCardJson`.
2. On submit, capture payload into `formSubmitPayloadJson`.
3. Parse payload and validate:
   - `action == select_catalog_item`
   - `itemSysId` not blank.
4. Save `selectedItemSysId`, then handoff to form topic.

## Step 6: Implement Form Rendering Topic

In `SN-03-RenderOrderFormCard`:
1. Call `get_catalog_item_form` with `selectedItemSysId`.
2. Save response text and parse JSON.
3. Extract `adaptiveCard` and assign to `itemFormCardJson`.
4. Handoff to submit topic.

## Step 7: Implement Submit Topic

In `SN-04-SubmitOrder`:
1. Send adaptive card from `itemFormCardJson`.
2. On submit, capture payload to `formSubmitPayloadJson`.
3. Build `variables` by removing `action` and `itemSysId` from submit payload.
4. Call `place_order` with:
   - `itemSysId = selectedItemSysId`
   - `variables = cleaned payload`
   - `quantity = 1`
   - `requestedFor = System.User.Email` (recommended)
   - optionally `requestedFor = user email/sys_id` when your Entra sign-in value does not match ServiceNow `email` or `user_name`
5. Parse result:
   - success -> render confirmation adaptive card from result.
   - failure -> handoff to fallback topic.

## Step 8: Implement Fallback Topic

In `SN-05-FallbackQuestionFlow`:
1. Explain card submission failed.
2. Collect missing details with guided questions.
3. Call `place_order` with collected variables.
4. Return confirmation.

## Step 9: End-To-End Tests

Run these scenarios in Copilot Studio test chat:

1. Happy path
- request laptop
- select item
- fill card
- submit
- receive confirmation card with request number

2. No results path
- use impossible query
- verify user refinement prompt

3. Form failure path
- intentionally select invalid item id
- verify graceful error and retry guidance

4. Fallback path
- simulate submit parsing failure
- verify question-based flow completes order

5. Permissions path
- test with user lacking catalog access
- verify no unauthorized items returned

## Step 10: Operational Readiness Checklist

- Correlation ID captured in topic and server logs.
- Order submissions are deduplicated (if idempotency added).
- Card schema compatibility confirmed in target channels.
- Retry messaging is user-friendly and deterministic.
- Topic handoffs do not create loops.

## Troubleshooting Notes

- If card does not render, inspect parsed JSON shape and channel card support.
- If submit payload is empty, ensure card has `Action.Submit` and inputs have unique `id`.
- If order fails, verify required ServiceNow variables and user permissions.
- If OAuth prompts fail, use existing setup/troubleshooting in [COPILOT_STUDIO_SETUP.md](COPILOT_STUDIO_SETUP.md).
