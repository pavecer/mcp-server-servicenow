# ServiceNow MCP - Customer Implementation Guide

## Overview

This guide shows customers how to implement a **simple, agent-driven ServiceNow ordering flow** in Copilot Studio without complex topic orchestration.

---

## Architecture: Complex vs. Simple

### ❌ Complex Path (Traditional Topic Orchestration)

**Current Implementation:**
```
User → Generative Recognizer → Multiple Topics Triggered:
  ├─ Search topic (calls MCP search_catalog_items)
  ├─ Selection topic (user picks item)
  ├─ Form topic (calls MCP get_catalog_item_form)
  ├─ Form Submission (adaptive card)
  └─ Order Confirmation (calls MCP place_order)
```

**Issues:**
- Multiple topic transitions
- Complex state management between topics
- Each step requires separate topic configuration
- Harder to debug and maintain
- Fragile: user utterances can trigger wrong topics

### ✅ Simple Path (Agent-Driven)

**Recommended Implementation:**
```
User Intent → Single Generative Agent with MCP Tools
  ↓
Agent uses intelligent planning:
  1. Searches catalog (MCP: search_catalog_items)
  2. Presents results (agent decides best format)
  3. Gets form (MCP: get_catalog_item_form)
  4. Shows adaptive card (agent renders)
  5. Collects variables (conversational)
  6. Places order (MCP: place_order)
  7. Confirms (agent summarizes)
```

**Benefits:**
- Single agent handles entire flow
- Natural conversation, no topic jumping
- Easier maintenance and updates
- Better error handling
- More flexible for variations

---

## Implementation: Simple Agent-Driven Flow

### Step 1: Configure Your GenerativeAI Agent

**Agent Configuration** (in `pve_agent.gpt.default`):

```yaml
displayName: "ServiceNow Ordering Agent"
description: "Helps users order items from the ServiceNow catalog"

# System instructions that guide agent behavior
instructions: |
  You are a helpful ServiceNow ordering assistant. Your goal is to help users:
  1. Search and find catalog items they need
  2. Review item details and form requirements
  3. Fill in the order form with their specifications
  4. Submit the order successfully

  ## Workflow

  When a user wants to order something:

  1. **SEARCH**: Call search_catalog_items with their request
     - Parse their natural language query
     - Search the catalog
     - If multiple results: present as numbered list, ask user to pick
     - If one result: proceed to step 2
     - If no results: suggest alternatives or ask for clarification

  2. **RETRIEVE FORM**: Call get_catalog_item_form with selected item sys_id
     - Get the adaptive card definition
     - Display the form to user
     - Explain what fields are required

  3. **COLLECT VARIABLES**: Converse naturally with user
     - Extract from user input: form variables, requested_for, quantity
     - Validate required fields
     - Ask clarifying questions if needed
     - Confirm values before submitting

  4. **PLACE ORDER**: Call place_order with:
     - itemSysId: the selected catalog item
     - variables: form field values (as object, keyed by field name)
     - requestedFor: caller's email or specified user
     - quantity: order quantity (if applicable)

  5. **CONFIRM**: 
     - Display request number, status, link to ServiceNow
     - Offer to help with anything else

  ## Field Value Extraction Examples

  User says: "I need an office chair, ergonomic setup required"
  Extract: { "ergonomic_office": "office chair, ergonomic setup" }

  User says: "Order for John Smith, he needs a laptop with 32GB RAM"
  Extract: { "requested_for": "john.smith@company.com", "ram_specification": "32GB" }

  ## Important Notes

  - Always confirm user intent before submitting orders
  - Use the caller's Entra ID email as default for requested_for
  - Handle multi-step forms conversationally, don't require all fields at once
  - Provide friendly, clear feedback at each step
  - Use adaptive cards for visual presentation of forms and confirmations

model: "gpt-4-turbo"  # Latest generative model for better reasoning
```

### Step 2: Configure MCP Tools (No Changes Needed)

Your MCP connector already provides:
- ✅ `search_catalog_items` - Search with query, optional filters
- ✅ `get_catalog_item_form` - Get adaptive card form definition  
- ✅ `place_order` - Submit order with variables
- ✅ `validate_servicenow_configuration` - Test connectivity

---

## Step 3: Create a Single Topic (Optional)

You can have ONE topic that triggers the agent:

```yaml
kind: AdaptiveDialog
id: "ServiceNow_Ordering"
displayName: "Order from ServiceNow"
description: "Help me order something from ServiceNow"

triggers:
  - kind: "phrases"
    phrases:
      - "order from servicenow"
      - "i need to order"
      - "catalog"
      - "office supplies"
      - "software"
      - "hardware"

actions:
  - kind: "CallGenerativeAIAgent"
    agentId: "pve_agent.gpt.default"
    parameters:
      userQuery: "topic.userInput"
      # Pass context
      userEmail: "topic.userPrincipalName"  # Copilot Studio variable
      orderingContext: "User is initiating a ServiceNow catalog order"
```

**Alternative:** Delete all topics. Let the **System Fallback** trigger the agent:

```yaml
# In your Fallback topic:

- When user utterance doesn't match any topic:
  "I can help you order items from ServiceNow. 
   What would you like to order?"
  
  → Call ServiceNow Ordering Agent with user message
```

---

## Step 4: User Conversation Flow (What Users See)

```
User:  "I need a new laptop"

Agent: "Great! Let me search our ServiceNow catalog for laptops.
        [Searching...]
        
        I found 3 options:
        1. Standard Developer Laptop - 8GB RAM, SSD
        2. Power User Laptop - 16GB RAM, High-performance GPU
        3. Server Admin Workstation - 32GB RAM, Enhanced specs
        
        Which one interests you?"

User:  "The Power User one"

Agent: "Perfect! Let me get the order form for that laptop.
        
        **Power User Laptop - Order Form:**
        - RAM Specification (optional): You said 16GB - that's selected
        - Monitor Preference (optional): [Dropdown]
        - Delivery Location: [Required]
        - Special Requirements: [Optional]
        
        Where should we deliver it?"

User:  "Building 4, desk 42"

Agent: "Any special requirements or notes?"

User:  "No, that's all"

Agent: "[Placing order...]
        
        ✅ **Order Submitted!**
        
        📋 Request: REQ0010067
        📦 Item: Power User Laptop
        📍 Delivery: Building 4, Desk 42
        ✓ Status: Approved
        
        🔗 [View in ServiceNow](https://dev310193.service-now.com/...)
        
        Can I help you with anything else?"

User:  "No thanks!"
```

---

## Implementation Checklist

- [ ] **1. Update Agent Instructions**
  - Edit `pve_agent.gpt.default` instructions in Copilot Studio
  - Copy the instructions from Step 1 above
  - Test with sample queries

- [ ] **2. Simplify or Remove Topics**
  - Delete `[CTOP] - SnowMCP OrderCat` (the intermediate form topic)
  - Delete intermediate selection topics
  - Keep only a trigger topic OR let fallback handle it

- [ ] **3. Configure MCP Connection**
  - Ensure ServiceNow MCP connector is configured
  - Test connectivity with `validate_servicenow_configuration` tool
  - Verify user mappings (email → ServiceNow user)

- [ ] **4. Test End-to-End**
  - Open Copilot Studio test pane
  - Say: "I want to order a laptop"
  - Verify: search → form display → order submission
  - Check ServiceNow for created request
  - Verify `requested_for` is set to correct user

- [ ] **5. Train the Agent (Optional)**
  - Provide sample conversations for complex scenarios
  - Show multi-variable forms handling
  - Demonstrate clarification questions

---

## Configuration Examples

### Example 1: Simple Topic (Minimal)

```yaml
kind: AdaptiveDialog
id: "order_from_servicenow"
displayName: "Order from ServiceNow"
triggers:
  - kind: "recognizerIntent"
    intent: "Order"

actions:
  - kind: "SendActivity"
    activity: "I'll help you order from our ServiceNow catalog. What would you like?"
  
  - kind: "CallGenerativeAgent"
    agentVariable: "response"
    includeDialogContext: true
```

### Example 2: No Topics (Fallback Only)

```yaml
# Configure your Fallback topic:

kind: AdaptiveDialog
displayName: "Fallback"
status: "Active"

actions:
  - kind: "ConditionGroup"
    conditions:
      - condition: "Contains(topic.userInput, 'order')"
        actions:
          - kind: "CallGenerativeAgent"  
            agentId: "pve_agent.gpt.default"
            fallback: "I can help you order items from our ServiceNow catalog..."
      
      - condition: "else"
        actions:
          - kind: "SendActivity"
            activity: "I'm not sure how to help with that. Try asking about ordering products."
```

---

## Variable Extraction: Agent Approach vs. Topic Approach

### ❌ Topic Approach (Complex)

```
Topic 1: Get search query
Topic 2: Display results
Topic 3: Get selection
Topic 4: Render form with each field as separate input
Topic 5: Validate each field
Topic 6: Build variables object
Topic 7: Submit order
```

**Problems:** Tedious, error-prone, hard to scale to new catalogs

### ✅ Agent Approach (Simple)

```
Agent reads user input → extracts all variables conversationally → confirms → submits

User: "I want a desk for building 3, and I prefer adjustable height"
Agent extracts: {
  "delivery_location": "building 3",
  "desk_type_preference": "adjustable height"
}

Agent: "Great! Adjustable desk for Building 3. Can you provide your seating preference?"
User: "Standing capability preferred"
Agent adds: "standing_capable": true

Agent: "Perfect! Order confirmed for adjustable standing desk..."
```

---

## Troubleshooting

### Agent Not Searching Correctly

**Problem:** Agent doesn't call the MCP tool
**Solution:** 
- Check agent instructions mention `search_catalog_items` tool explicitly
- Verify MCP connector is connected
- Test with Tool definition visible: "Based on your request, I'll call the catalog search tool..."

### Form Variables Not Extracted

**Problem:** Agent calls `place_order` but with empty/wrong variables
**Solution:**
- Update instructions with specific examples of variable extraction
- Add clarifying question: "What are your preferences for [field]?"
- Provide sample user inputs in instructions

### Requested-For Not Set Correctly

**Problem:** Order created under integration_user instead of caller
**Solution:**
- Agent instructions must extract from user context
- Verify `callerUpn` is available (comes from Entra token)
- MCP server will resolve email → ServiceNow user automatically

### Adaptive Card Not Rendering

**Problem:** Form shows as text, not card
**Solution:**
- Agent should return adaptive card JSON as-is (not escaped)
- Copilot Studio auto-renders JSON cards
- Check `get_catalog_item_form` returns proper `adaptiveCard` field

---

## Best Practices

### ✅ DO:

- Keep agent instructions short and focused
- Use examples of variable extraction in instructions
- Add clarifying questions for ambiguous fields
- Confirm user intent before ordering
- Show adaptive cards for forms (use agent to display)
- Test with various user intents before deployment
- Monitor agent logs for misunderstandings
- Provide feedback loops: "Did that help?"

### ❌ DON'T:

- Don't hardcode field names in topics
- Don't create separate topics for each catalog item type
- Don't require users to fill forms in strict order
- Don't skip confirmation step
- Don't assume email format matches ServiceNow usernames
- Don't leave default system prompts (customize for your catalog)

---

## Integration with Other Systems

### Connect to Multiple Catalogs

```yaml
instructions: |
  You manage ordering from multiple catalogs:
  - IT Hardware (laptops, monitors, peripherals)
  - Office Supplies (furniture, stationery)
  - Software (licenses, tools)
  
  When user asks to order:
  1. Determine which catalog (ask if unclear)
  2. Search that catalog with search_catalog_items
  3. Continue standard flow
```

### Add Approval Workflows

```yaml
actions:
  - kind: "CallGenerativeAgent"
    # Order submitted in ServiceNow
    
  - kind: "Variable"
    name: "requestNumber"
    value: "response.requestNumber"
  
  - kind: "SendActivity"
    activity: "Your order {{requestNumber}} is pending manager approval. 
              You'll receive a notification when approved."
```

### Route to Human Agent

```yaml
- kind: "ConditionGroup"
  conditions:
    - condition: "response.orderTotal > 5000"  # High-value orders
      actions:
        - kind: "EscalateToHuman"
          department: "Procurement"
          context: "High-value ServiceNow order {{requestNumber}}"
```

---

## Summary

**Old Way (Complex):**
- Multiple topics orchestrating the flow
- Fragile state management
- Hard to maintain and update

**New Way (Simple):**
- Single agent with clear instructions
- Natural conversation flow
- Easy to customize and extend
- Better error handling and user experience

**Implementation Time:** 
- **Simple Path:** 30 minutes to configure
- **Complex Path:** 2-3 hours of topic design and testing

---

## Support & Examples

For detailed examples:
- See [docs/MCS_SERVICENOW_ORDERING_RUNBOOK.md](docs/MCS_SERVICENOW_ORDERING_RUNBOOK.md) for catalog setup
- See [README.md](README.md) for MCP tool specifications
- Test with sample queries in Copilot Studio chat pane

**Questions?** Review the agent instructions section — customize for your specific catalog and workflow.
