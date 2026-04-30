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
