import { describe, it, expect } from "vitest";
import {
  buildCatalogItemSelectionAdaptiveCard,
  buildOrderConfirmationAdaptiveCard,
  buildOrderFormAdaptiveCard
} from "../src/utils/adaptiveCards";
import type {
  ServiceNowCatalogItem,
  ServiceNowCatalogItemDetail,
  ServiceNowOrderResult
} from "../src/types/servicenow";

describe("buildCatalogItemSelectionAdaptiveCard", () => {
  it("emits a selectAction with the item sys_id for each item", () => {
    const items: ServiceNowCatalogItem[] = [
      { sys_id: "abc", name: "Laptop" },
      { sys_id: "def", name: "Monitor", short_description: "27&quot; display" }
    ];

    const card = buildCatalogItemSelectionAdaptiveCard(items);

    expect(card.type).toBe("AdaptiveCard");
    const body = card.body as Array<Record<string, unknown>>;
    // header (2) + 2 item containers
    expect(body.length).toBe(4);

    const [, , first, second] = body;
    expect((first.selectAction as Record<string, unknown>).data).toMatchObject({
      action: "select_catalog_item",
      itemSysId: "abc"
    });
    expect((second.selectAction as Record<string, unknown>).data).toMatchObject({
      action: "select_catalog_item",
      itemSysId: "def"
    });

    // HTML entity should have been decoded.
    const secondItems = second.items as Array<Record<string, unknown>>;
    const descriptionBlock = secondItems[1] as Record<string, unknown>;
    expect(descriptionBlock.text).toContain('"');
    expect(descriptionBlock.text).not.toContain("&quot;");
  });
});

describe("buildOrderFormAdaptiveCard", () => {
  it("renders an Input.Text for a single-line variable and marks mandatory inputs", () => {
    const item: ServiceNowCatalogItemDetail = {
      sys_id: "item1",
      name: "Item",
      variables: [
        {
          name: "justification",
          label: "Justification",
          type: "1",
          mandatory: true
        }
      ]
    };

    const card = buildOrderFormAdaptiveCard(item);
    const body = card.body as Array<Record<string, unknown>>;
    const input = body.find(b => b.type === "Input.Text") as Record<string, unknown>;

    expect(input).toBeDefined();
    expect(input.id).toBe("justification");
    expect(input.label).toBe("Justification *");
    expect(input.isRequired).toBe(true);
  });

  it("renders Input.ChoiceSet from a string-encoded choices field", () => {
    const item: ServiceNowCatalogItemDetail = {
      sys_id: "item2",
      name: "Choice item",
      variables: [
        {
          name: "color",
          label: "Color",
          type: "14",
          choices: "Red\nGreen\nBlue"
        }
      ]
    };

    const card = buildOrderFormAdaptiveCard(item);
    const body = card.body as Array<Record<string, unknown>>;
    const choice = body.find(b => b.type === "Input.ChoiceSet") as Record<string, unknown>;

    expect(choice).toBeDefined();
    expect(choice.id).toBe("color");
    expect(choice.choices).toEqual([
      { title: "Red", value: "Red" },
      { title: "Green", value: "Green" },
      { title: "Blue", value: "Blue" }
    ]);
    expect(choice.isMultiSelect).toBe(false);
  });

  it("attaches a place_order Submit action carrying the itemSysId", () => {
    const item: ServiceNowCatalogItemDetail = {
      sys_id: "item3",
      name: "Item",
      variables: []
    };

    const card = buildOrderFormAdaptiveCard(item);
    const actions = card.actions as Array<Record<string, unknown>>;
    expect(actions[0]).toMatchObject({
      type: "Action.Submit",
      data: { action: "place_order", itemSysId: "item3" }
    });
  });

  it("does not leak unevaluated GlideScript default values into the rendered input", () => {
    const item: ServiceNowCatalogItemDetail = {
      sys_id: "item-glide",
      name: "GlideScript default",
      variables: [
        {
          name: "requested_for",
          label: "Requested for",
          type: "31",
          mandatory: true,
          default_value: "javascript:gs.getUserID();"
        }
      ]
    };

    const card = buildOrderFormAdaptiveCard(item);
    const body = card.body as Array<Record<string, unknown>>;
    const input = body.find(b => b.id === "requested_for") as Record<string, unknown>;

    expect(input).toBeDefined();
    // The literal "javascript:..." snippet must never reach the rendered Adaptive Card.
    expect(input.value).not.toBe("javascript:gs.getUserID();");
    expect(typeof input.value === "string" ? (input.value as string) : "").not.toMatch(/^javascript:/i);
    expect(JSON.stringify(card)).not.toContain("javascript:");
  });

  it("preserves a legitimate string default value when it is not GlideScript", () => {
    const item: ServiceNowCatalogItemDetail = {
      sys_id: "item-default",
      name: "Real default",
      variables: [
        {
          name: "location",
          label: "Location",
          type: "1",
          default_value: "Headquarters"
        }
      ]
    };

    const card = buildOrderFormAdaptiveCard(item);
    const body = card.body as Array<Record<string, unknown>>;
    const input = body.find(b => b.id === "location") as Record<string, unknown>;

    expect(input?.value).toBe("Headquarters");
  });

  it("skips ServiceNow UI macros (friendly_type = 'macro') instead of emitting a stub input", () => {
    // Mirrors Retire Change Template's `button_renderer` variable on
    // dev310193: friendly_type "macro" / display_type "Custom" / no label.
    // Such variables only render in the native ServiceNow form and have no
    // meaningful Adaptive Card analog.
    const item: ServiceNowCatalogItemDetail = {
      sys_id: "macro-test",
      name: "Item with a macro",
      variables: [
        {
          name: "button_renderer",
          label: "",
          type: 14 as unknown as string,
          friendly_type: "macro",
          display_type: "Custom"
        },
        {
          name: "justification",
          label: "Justification",
          type: 2 as unknown as string,
          mandatory: true
        }
      ]
    };

    const card = buildOrderFormAdaptiveCard(item);
    const body = card.body as Array<Record<string, unknown>>;

    // The macro renderer must not appear as an input.
    expect(body.find(b => b.id === "button_renderer")).toBeUndefined();
    // The real input is still emitted.
    expect(body.find(b => b.id === "justification")).toBeDefined();
  });
});

describe("buildOrderConfirmationAdaptiveCard", () => {
  it("builds a deep link into ServiceNow when a request_id is present", () => {
    const result: ServiceNowOrderResult = {
      request_number: "REQ0001234",
      request_id: "abc123",
      sys_id: "abc123"
    };

    const card = buildOrderConfirmationAdaptiveCard(
      result,
      "https://test.service-now.com/"
    );

    const actions = card.actions as Array<Record<string, unknown>> | undefined;
    // The card always contains a link/Action.OpenUrl referencing the request.
    const flattened = JSON.stringify(card);
    expect(flattened).toContain("REQ0001234");
    expect(flattened).toContain("sys_id=abc123");
    expect(flattened).not.toContain("//nav_to.do"); // trailing slash should be stripped
    expect(actions).toBeDefined();
  });

  it("falls back to the bare instance URL when request_id is missing", () => {
    const result: ServiceNowOrderResult = {
      request_number: "REQ0001235"
    };

    const card = buildOrderConfirmationAdaptiveCard(result, "https://test.service-now.com");
    const flattened = JSON.stringify(card);
    expect(flattened).toContain("REQ0001235");
    expect(flattened).not.toContain("sys_id=");
  });
});
