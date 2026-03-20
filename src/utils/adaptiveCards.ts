import { ServiceNowCatalogItemDetail, ServiceNowOrderResult, ServiceNowVariable } from "../types/servicenow";

/**
 * Maps a ServiceNow variable to an Adaptive Card input element.
 * ServiceNow variable types (numeric strings):
 *  1 = Single-line text, 2 = Multi-line text, 3 = Integer, 4 = Decimal,
 *  5 = Boolean/checkbox, 6 = Date/Time, 7 = Email, 8 = Date,
 *  14 = Select box, 18 = Lookup select, 21 = Multiple choice
 */
function buildVariableInput(variable: ServiceNowVariable): Record<string, unknown> | null {
  const type = variable.type?.toString() ?? "1";
  const label = variable.label + (variable.mandatory ? " *" : "");
  const required = variable.mandatory ?? false;

  // Dropdown / select
  if (["14", "18", "21", "select"].includes(type) || (variable.choices && variable.choices.length > 0)) {
    return {
      type: "Input.ChoiceSet",
      id: variable.name,
      label,
      placeholder: variable.instructions ?? `Select ${variable.label}`,
      value: variable.default_value ?? "",
      choices: (variable.choices ?? []).map(c => ({ title: c.label, value: c.value })),
      isRequired: required
    };
  }

  // Boolean / checkbox
  if (["5", "boolean"].includes(type)) {
    return {
      type: "Input.Toggle",
      id: variable.name,
      label,
      title: variable.instructions ?? variable.label,
      value: variable.default_value === "true" ? "true" : "false"
    };
  }

  // Date
  if (["8", "date"].includes(type)) {
    return {
      type: "Input.Date",
      id: variable.name,
      label,
      value: variable.default_value ?? "",
      isRequired: required
    };
  }

  // Date/Time
  if (["6", "datetime"].includes(type)) {
    return {
      type: "Input.Date",
      id: variable.name,
      label,
      value: variable.default_value ? variable.default_value.split(" ")[0] : "",
      isRequired: required
    };
  }

  // Multi-line text
  if (type === "2") {
    return {
      type: "Input.Text",
      id: variable.name,
      label,
      placeholder: variable.instructions ?? `Enter ${variable.label}`,
      value: variable.default_value ?? "",
      isMultiline: true,
      isRequired: required
    };
  }

  // Number (integer / decimal)
  if (["3", "4"].includes(type)) {
    return {
      type: "Input.Number",
      id: variable.name,
      label,
      placeholder: variable.instructions ?? `Enter ${variable.label}`,
      value: variable.default_value ? Number(variable.default_value) : undefined,
      isRequired: required
    };
  }

  // Default: single-line text (covers type 1, 7, and any unknown)
  return {
    type: "Input.Text",
    id: variable.name,
    label,
    placeholder: variable.instructions ?? `Enter ${variable.label}`,
    value: variable.default_value ?? "",
    isRequired: required
  };
}

/**
 * Builds an Adaptive Card that represents the order form for a catalog item.
 * The card contains inputs for each variable and a submit action.
 */
export function buildOrderFormAdaptiveCard(item: ServiceNowCatalogItemDetail): Record<string, unknown> {
  const body: Record<string, unknown>[] = [
    {
      type: "TextBlock",
      text: item.name,
      size: "Large",
      weight: "Bolder",
      wrap: true
    }
  ];

  if (item.short_description) {
    body.push({
      type: "TextBlock",
      text: item.short_description,
      wrap: true,
      spacing: "Small"
    });
  }

  if (item.description && item.description !== item.short_description) {
    body.push({
      type: "TextBlock",
      text: item.description,
      wrap: true,
      isSubtle: true,
      spacing: "Small"
    });
  }

  if (item.variables && item.variables.length > 0) {
    body.push({
      type: "TextBlock",
      text: "Order Details",
      weight: "Bolder",
      spacing: "Medium"
    });

    for (const variable of item.variables) {
      const input = buildVariableInput(variable);
      if (input) {
        body.push(input);
      }
    }
  }

  return {
    type: "AdaptiveCard",
    $schema: "http://adaptivecards.io/schemas/adaptive-card.json",
    version: "1.5",
    body,
    actions: [
      {
        type: "Action.Submit",
        title: "Place Order",
        style: "positive",
        data: {
          action: "place_order",
          itemSysId: item.sys_id
        }
      }
    ]
  };
}

/**
 * Builds an Adaptive Card that confirms a placed order.
 * Shows the request number, status, and a link to ServiceNow.
 */
export function buildOrderConfirmationAdaptiveCard(
  result: ServiceNowOrderResult,
  instanceUrl: string
): Record<string, unknown> {
  const requestUrl = result.request_id
    ? `${instanceUrl.replace(/\/$/, "")}/nav_to.do?uri=sc_request.do?sys_id=${result.request_id}`
    : instanceUrl.replace(/\/$/, "");

  const facts: Record<string, string>[] = [
    { title: "Request Number:", value: result.request_number },
    { title: "Status:", value: "Submitted" }
  ];

  if (result.request_id) {
    facts.push({ title: "Request ID:", value: result.request_id });
  }

  return {
    type: "AdaptiveCard",
    $schema: "http://adaptivecards.io/schemas/adaptive-card.json",
    version: "1.5",
    body: [
      {
        type: "TextBlock",
        text: "Order Submitted Successfully",
        size: "Large",
        weight: "Bolder",
        color: "Good",
        wrap: true
      },
      {
        type: "FactSet",
        facts
      },
      {
        type: "TextBlock",
        text: "Your request has been submitted to ServiceNow. You can track its status using the link below.",
        wrap: true,
        spacing: "Medium",
        isSubtle: true
      }
    ],
    actions: [
      {
        type: "Action.OpenUrl",
        title: "View Request in ServiceNow",
        url: requestUrl
      }
    ]
  };
}
