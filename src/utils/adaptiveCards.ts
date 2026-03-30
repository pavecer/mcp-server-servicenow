import { ServiceNowCatalogItem, ServiceNowCatalogItemDetail, ServiceNowOrderResult, ServiceNowVariable } from "../types/servicenow";

/**
 * ServiceNow catalog fields may contain HTML markup. Adaptive Card TextBlock
 * does not render raw HTML, so convert it into readable plain text.
 */
function toAdaptiveText(value?: string): string {
  if (!value) {
    return "";
  }

  const decoded = value
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'");

  const text = decoded
    .replace(/<\s*br\s*\/?\s*>/gi, "\n")
    .replace(/<\s*\/p\s*>/gi, "\n\n")
    .replace(/<\s*\/div\s*>/gi, "\n")
    .replace(/<\s*li[^>]*>/gi, "• ")
    .replace(/<\s*\/li\s*>/gi, "\n")
    .replace(/<\s*\/?\s*(ul|ol)\b[^>]*>/gi, "\n")
    .replace(/<[^>]+>/g, "");

  const normalized = text
    .replace(/\r/g, "")
    .split("\n")
    .map(line => line.replace(/\s+/g, " ").trim())
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();

  return normalized;
}

function normalizeVariableType(variable: ServiceNowVariable): string {
  const candidates = [
    variable.type,
    variable.question_type,
    variable.ui_type,
    variable.field_type
  ];

  for (const candidate of candidates) {
    if (candidate === undefined || candidate === null) {
      continue;
    }

    if (typeof candidate === "string" || typeof candidate === "number") {
      return String(candidate).trim().toLowerCase();
    }

    if (typeof candidate === "object") {
      const raw = (candidate as Record<string, unknown>).value
        ?? (candidate as Record<string, unknown>).name
        ?? (candidate as Record<string, unknown>).type;
      if (typeof raw === "string" || typeof raw === "number") {
        return String(raw).trim().toLowerCase();
      }
    }
  }

  return "1";
}

function normalizeChoices(variable: ServiceNowVariable): Array<{ title: string; value: string }> {
  const rawChoices = variable.choices;
  if (!rawChoices) {
    return [];
  }

  if (Array.isArray(rawChoices)) {
    return rawChoices
      .map(choice => {
        if (typeof choice === "string" || typeof choice === "number") {
          const value = String(choice);
          return { title: value, value };
        }

        if (!choice || typeof choice !== "object") {
          return null;
        }

        const entry = choice as unknown as Record<string, unknown>;
        const rawValue = entry.value ?? entry.name ?? entry.id;
        const rawTitle = entry.label ?? entry.title ?? entry.text ?? rawValue;

        if (rawValue === undefined || rawValue === null || rawTitle === undefined || rawTitle === null) {
          return null;
        }

        const value = String(rawValue);
        const title = toAdaptiveText(String(rawTitle)) || String(rawTitle);
        return { title, value };
      })
      .filter((choice): choice is { title: string; value: string } => Boolean(choice));
  }

  if (typeof rawChoices === "object") {
    const entries = Object.entries(rawChoices as Record<string, unknown>);
    return entries
      .map(([key, raw]) => {
        if (raw === undefined || raw === null) {
          return null;
        }

        if (typeof raw === "string" || typeof raw === "number") {
          return {
            title: toAdaptiveText(String(raw)) || String(raw),
            value: key
          };
        }

        if (typeof raw === "object") {
          const entry = raw as Record<string, unknown>;
          const rawValue = entry.value ?? key;
          const rawTitle = entry.label ?? entry.title ?? entry.text ?? rawValue;
          if (rawValue === undefined || rawValue === null || rawTitle === undefined || rawTitle === null) {
            return null;
          }
          return {
            title: toAdaptiveText(String(rawTitle)) || String(rawTitle),
            value: String(rawValue)
          };
        }

        return null;
      })
      .filter((choice): choice is { title: string; value: string } => Boolean(choice));
  }

  return [];
}

function isMultiSelectType(type: string): boolean {
  return ["21", "33", "multiple", "multiple_choice", "checkbox", "check_box", "multi_select"].includes(type);
}

/**
 * Builds an Adaptive Card that presents a list of catalog items for the user
 * to choose from after a search. Each item is shown with its name, description,
 * category, and catalog, and can be selected by tapping/clicking the item
 * container, which submits the item's sys_id back to the agent so it can
 * proceed to get_catalog_item_form.
 */
export function buildCatalogItemSelectionAdaptiveCard(
  items: ServiceNowCatalogItem[]
): Record<string, unknown> {
  const body: Record<string, unknown>[] = [
    {
      type: "TextBlock",
      text: "Select a Catalog Item",
      size: "Large",
      weight: "Bolder",
      wrap: true
    },
    {
      type: "TextBlock",
      text: "Choose the item that best matches your request:",
      wrap: true,
      spacing: "Small",
      isSubtle: true
    }
  ];

  for (const item of items) {
    const facts: Record<string, string>[] = [];
    const itemName = toAdaptiveText(item.name) || item.name;
    const shortDescription = toAdaptiveText(item.short_description);

    const categoryLabelRaw = item.category?.title ?? item.category?.name;
    const catalogLabelRaw = item.sc_catalog?.title ?? item.sc_catalog?.name;
    const categoryLabel = categoryLabelRaw ? toAdaptiveText(categoryLabelRaw) : undefined;
    const catalogLabel = catalogLabelRaw ? toAdaptiveText(catalogLabelRaw) : undefined;

    if (categoryLabel) {
      facts.push({ title: "Category:", value: categoryLabel });
    }
    if (catalogLabel) {
      facts.push({ title: "Catalog:", value: catalogLabel });
    }

    const container: Record<string, unknown> = {
      type: "Container",
      spacing: "Medium",
      style: "emphasis",
      items: [
        {
          type: "TextBlock",
          text: itemName,
          weight: "Bolder",
          wrap: true
        },
        ...(item.short_description
          ? [
              {
                type: "TextBlock",
                text: shortDescription,
                wrap: true,
                isSubtle: true,
                spacing: "Small"
              }
            ]
          : []),
        ...(facts.length > 0
          ? [{ type: "FactSet", facts, spacing: "Small" }]
          : [])
      ],
      selectAction: {
        type: "Action.Submit",
        data: {
          action: "select_catalog_item",
          itemSysId: item.sys_id,
          itemName
        }
      }
    };

    body.push(container);
  }

  return {
    type: "AdaptiveCard",
    $schema: "http://adaptivecards.io/schemas/adaptive-card.json",
    version: "1.5",
    body,
    actions: []
  };
}

/**
 * Maps a ServiceNow variable to an Adaptive Card input element.
 * ServiceNow variable types (numeric strings):
 *  1 = Single-line text, 2 = Multi-line text, 3 = Integer, 4 = Decimal,
 *  5 = Boolean/checkbox, 6 = Date/Time, 7 = Email, 8 = Date,
 *  14 = Select box, 18 = Lookup select, 21 = Multiple choice
 */
function buildVariableInput(variable: ServiceNowVariable): Record<string, unknown> | null {
  const type = normalizeVariableType(variable);
  const choices = normalizeChoices(variable);
  const normalizedLabel = toAdaptiveText(variable.label) || variable.name;
  const normalizedInstructions = toAdaptiveText(variable.instructions);
  const label = normalizedLabel + (variable.mandatory ? " *" : "");
  const required = variable.mandatory ?? false;

  // Dropdown / select
  if (choices.length > 0 || ["14", "18", "21", "select", "lookup", "choice"].includes(type)) {
    return {
      type: "Input.ChoiceSet",
      id: variable.name,
      label,
      placeholder: normalizedInstructions || `Select ${normalizedLabel}`,
      value: variable.default_value ?? "",
      choices,
      isMultiSelect: isMultiSelectType(type),
      style: isMultiSelectType(type) ? "expanded" : "compact",
      isRequired: required
    };
  }

  // Boolean / checkbox
  if (["5", "boolean"].includes(type)) {
    return {
      type: "Input.Toggle",
      id: variable.name,
      label,
      title: normalizedInstructions || normalizedLabel,
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
      placeholder: normalizedInstructions || `Enter ${normalizedLabel}`,
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
      placeholder: normalizedInstructions || `Enter ${normalizedLabel}`,
      value: variable.default_value ? Number(variable.default_value) : undefined,
      isRequired: required
    };
  }

  // Default: single-line text (covers type 1, 7, and any unknown)
  return {
    type: "Input.Text",
    id: variable.name,
    label,
    placeholder: normalizedInstructions || `Enter ${normalizedLabel}`,
    value: variable.default_value ?? "",
    isRequired: required
  };
}

/**
 * Builds an Adaptive Card that represents the order form for a catalog item.
 * The card contains inputs for each variable and a submit action.
 */
export function buildOrderFormAdaptiveCard(item: ServiceNowCatalogItemDetail): Record<string, unknown> {
  const shortDescription = toAdaptiveText(item.short_description);
  const description = toAdaptiveText(item.description);

  const body: Record<string, unknown>[] = [
    {
      type: "TextBlock",
      text: toAdaptiveText(item.name),
      size: "Large",
      weight: "Bolder",
      wrap: true
    }
  ];

  if (shortDescription) {
    body.push({
      type: "TextBlock",
      text: shortDescription,
      wrap: true,
      spacing: "Small"
    });
  }

  if (description && description !== shortDescription) {
    body.push({
      type: "TextBlock",
      text: description,
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
