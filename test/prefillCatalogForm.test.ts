import { describe, it, expect } from "vitest";
import { computePrefillValues } from "../src/utils/prefillCatalogForm";
import { buildOrderFormAdaptiveCard } from "../src/utils/adaptiveCards";
import type { ServiceNowCatalogItemDetail } from "../src/types/servicenow";

/**
 * Representative "Apple iPhone" catalog item shape used across the tests.
 * Field names/types mirror what a typical ServiceNow Service Catalog item
 * exposes for a phone request:
 *   - Color, Storage, Carrier: select boxes (type 14)
 *   - Model variant: select box (type 14)
 *   - Justification: multi-line text (type 2)
 *   - Quantity: integer (type 3)
 *   - Need-by date: date (type 8)
 *   - Include AppleCare: boolean (type 5)
 */
function iphoneItem(): ServiceNowCatalogItemDetail {
  return {
    sys_id: "iphone_sys_id",
    name: "Apple iPhone",
    short_description: "Request a new company iPhone",
    variables: [
      {
        name: "model",
        label: "Model",
        type: "14",
        choices: "iPhone 15\niPhone 15 Plus\niPhone 15 Pro\niPhone 15 Pro Max"
      },
      {
        name: "color",
        label: "Color",
        type: "14",
        choices: "Black\nBlue\nGreen\nPink\nYellow\nNatural Titanium\nBlue Titanium"
      },
      {
        name: "storage",
        label: "Storage",
        type: "14",
        choices: "128GB\n256GB\n512GB\n1TB"
      },
      {
        name: "carrier",
        label: "Carrier",
        type: "14",
        choices: "Verizon\nAT&T\nT-Mobile\nUnlocked"
      },
      {
        name: "applecare",
        label: "Include AppleCare+",
        type: "5"
      },
      {
        name: "quantity",
        label: "Quantity",
        type: "3"
      },
      {
        name: "need_by",
        label: "Need by date",
        type: "8"
      },
      {
        name: "justification",
        label: "Business Justification",
        type: "2",
        mandatory: true
      }
    ]
  };
}

describe("computePrefillValues (iPhone scenario)", () => {
  it("prefills choice fields from structured hints using label keywords", () => {
    const item = iphoneItem();
    const { values, diagnostics } = computePrefillValues(item.variables, {
      prefillHints: {
        color: "black",
        storage: "256",
        carrier: "verizon",
        model: "pro max"
      }
    });

    expect(values).toMatchObject({
      color: "Black",
      storage: "256GB",
      carrier: "Verizon",
      model: "iPhone 15 Pro Max"
    });

    // Every hint produced a diagnostic entry sourced from the hint path.
    const byName = Object.fromEntries(diagnostics.map(d => [d.variableName, d]));
    expect(byName.color.source).toMatch(/^hint_/);
    expect(byName.storage.source).toMatch(/^hint_/);
  });

  it("matches a hint by normalized label keyword when the variable.name differs", () => {
    const item: ServiceNowCatalogItemDetail = {
      sys_id: "x", name: "X",
      variables: [
        { name: "u_phone_color", label: "Phone Color", type: "14", choices: "Red\nBlue" }
      ]
    };
    const { values, diagnostics } = computePrefillValues(item.variables, {
      prefillHints: { color: "Red" }
    });
    expect(values.u_phone_color).toBe("Red");
    expect(diagnostics[0].source).toBe("hint_label_match");
  });

  it("prefills via the exact variable name when the hint key matches it", () => {
    const item = iphoneItem();
    const { values, diagnostics } = computePrefillValues(item.variables, {
      prefillHints: { color: "Blue" }
    });
    expect(values.color).toBe("Blue");
    expect(diagnostics.find(d => d.variableName === "color")?.source).toBe("hint_exact_name");
  });

  it("normalizes a fuzzy storage hint against the actual choice list", () => {
    const item = iphoneItem();
    const { values } = computePrefillValues(item.variables, {
      prefillHints: { storage: "1tb" }
    });
    expect(values.storage).toBe("1TB");
  });

  it("does NOT inject a value when the hint cannot be matched to a choice", () => {
    const item = iphoneItem();
    const { values } = computePrefillValues(item.variables, {
      prefillHints: { color: "fuchsia" } // not a valid choice
    });
    expect(values.color).toBeUndefined();
  });

  it("coerces hint booleans for boolean-type variables", () => {
    const item = iphoneItem();
    const { values } = computePrefillValues(item.variables, {
      prefillHints: { applecare: true }
    });
    expect(values.applecare).toBe(true);
  });

  it("coerces hint numbers for numeric variables", () => {
    const item = iphoneItem();
    const { values } = computePrefillValues(item.variables, {
      prefillHints: { quantity: 2 }
    });
    expect(values.quantity).toBe(2);
  });

  it("passes a multi-line justification straight through as text", () => {
    const item = iphoneItem();
    const justification = "Replacement for damaged corporate phone, urgent.";
    const { values } = computePrefillValues(item.variables, {
      prefillHints: { justification }
    });
    expect(values.justification).toBe(justification);
  });

  it("falls back to free-text userContext when no hint is provided", () => {
    const item = iphoneItem();
    const { values, diagnostics } = computePrefillValues(item.variables, {
      userContext:
        "Hi, I need a new black iPhone 15 Pro with 256GB on Verizon. Needed by 2026-07-01. I want 1 unit."
    });

    expect(values.color).toBe("Black");
    expect(values.storage).toBe("256GB");
    expect(values.carrier).toBe("Verizon");
    expect(values.model).toBe("iPhone 15 Pro");
    expect(values.need_by).toBe("2026-07-01");
    expect(values.quantity).toBe(1);

    // All from context, not from hints.
    for (const d of diagnostics) {
      expect(d.source).not.toBe("hint_exact_name");
      expect(d.source).not.toBe("hint_label_match");
    }
  });

  it("populates the multi-line justification field from userContext as a fallback", () => {
    const item = iphoneItem();
    const ctx = "Phone was lost during business travel and needs replacement urgently.";
    const { values } = computePrefillValues(item.variables, { userContext: ctx });
    expect(values.justification).toBe(ctx);
  });

  it("truncates very long userContext when filling justification", () => {
    const item = iphoneItem();
    const ctx = "x".repeat(1000);
    const { values } = computePrefillValues(item.variables, { userContext: ctx });
    expect(String(values.justification).length).toBeLessThanOrEqual(500);
    expect(String(values.justification)).toMatch(/\.\.\.$/);
  });

  it("hints take precedence over userContext when both are provided", () => {
    const item = iphoneItem();
    const { values } = computePrefillValues(item.variables, {
      userContext: "User mentioned the color blue.",
      prefillHints: { color: "Pink" }
    });
    expect(values.color).toBe("Pink");
  });

  it("returns empty results when no inputs are provided", () => {
    const item = iphoneItem();
    const { values, diagnostics } = computePrefillValues(item.variables, {});
    expect(values).toEqual({});
    expect(diagnostics).toEqual([]);
  });

  it("respects visible:false and readonly:true (no prefill applied)", () => {
    const item: ServiceNowCatalogItemDetail = {
      sys_id: "x",
      name: "X",
      variables: [
        { name: "color", label: "Color", type: "14", choices: "Red\nBlue", visible: false },
        { name: "carrier", label: "Carrier", type: "14", choices: "Verizon", readonly: true }
      ]
    };
    const { values } = computePrefillValues(item.variables, {
      prefillHints: { color: "Red", carrier: "Verizon" }
    });
    expect(values).toEqual({});
  });

  // -------------------------------------------------------------------------
  // Regression coverage for the real "Apple iPhone 13" demo item shape
  // (sys_id ec80c13297968d1021983d1e6253af32 on dev310193). Its color
  // choices use marketing names ("Midnight", "Starlight") and the
  // replacement question is a Yes/No choice list keyed by a long label.
  // -------------------------------------------------------------------------
  function iphone13DemoItem(): ServiceNowCatalogItemDetail {
    return {
      sys_id: "iphone13",
      name: "Apple iPhone 13",
      variables: [
        {
          name: "is_this_a_replacement_for_a_lost_or_broken_iphone",
          label: "Is this a replacement for a lost or broken iPhone?",
          type: "3",
          mandatory: true,
          choices: "Yes\nNo"
        },
        {
          name: "color",
          label: "Choose the colour",
          type: "3",
          mandatory: true,
          choices: "Green\nPink\nBlue\nMidnight\nStarlight\nRed"
        },
        {
          name: "storage",
          label: "Choose the storage",
          type: "3",
          mandatory: true,
          choices: "128 GB\n256 GB\n512 GB"
        }
      ]
    };
  }

  it("maps an everyday color name to the catalog's marketing color via synonyms", () => {
    const item = iphone13DemoItem();
    const { values, diagnostics } = computePrefillValues(item.variables, {
      prefillHints: { color: "black" }
    });
    expect(values.color).toBe("Midnight");
    expect(diagnostics.find(d => d.variableName === "color")?.source).toMatch(/^hint_/);
  });

  it("maps a color synonym from free-text userContext too", () => {
    const item = iphone13DemoItem();
    const { values } = computePrefillValues(item.variables, {
      userContext: "I need a black iPhone please."
    });
    expect(values.color).toBe("Midnight");
  });

  it("infers Yes on the replacement question from damage/loss keywords", () => {
    const item = iphone13DemoItem();
    const { values, diagnostics } = computePrefillValues(item.variables, {
      userContext: "My old phone is damaged and needs replacement."
    });
    expect(values.is_this_a_replacement_for_a_lost_or_broken_iphone).toBe("Yes");
    expect(
      diagnostics.find(d => d.variableName === "is_this_a_replacement_for_a_lost_or_broken_iphone")?.matchedText
    ).toBe("replacement signal");
  });

  it("infers No on the replacement question for first-time / new-hire signals", () => {
    const item = iphone13DemoItem();
    const { values } = computePrefillValues(item.variables, {
      userContext: "This is for a new hire starting next week, their first phone."
    });
    expect(values.is_this_a_replacement_for_a_lost_or_broken_iphone).toBe("No");
  });

  it("accepts a boolean hint on a Yes/No replacement question", () => {
    const item = iphone13DemoItem();
    const { values } = computePrefillValues(item.variables, {
      prefillHints: { is_this_a_replacement_for_a_lost_or_broken_iphone: true }
    });
    expect(values.is_this_a_replacement_for_a_lost_or_broken_iphone).toBe("Yes");
  });

  it("normalizes a storage hint with embedded space ('256 GB' choice <- '256' hint)", () => {
    const item = iphone13DemoItem();
    const { values } = computePrefillValues(item.variables, {
      prefillHints: { storage: "256" }
    });
    expect(values.storage).toBe("256 GB");
  });

  it("real-world combined scenario: prefills color (synonym), storage, and replacement", () => {
    const item = iphone13DemoItem();
    const { values } = computePrefillValues(item.variables, {
      userContext: "My old iPhone is broken and I need a replacement, black, 256GB.",
      prefillHints: { color: "black", storage: "256" }
    });
    expect(values).toMatchObject({
      color: "Midnight",
      storage: "256 GB",
      is_this_a_replacement_for_a_lost_or_broken_iphone: "Yes"
    });
  });

  // -------------------------------------------------------------------------
  // Regression coverage for the real "Sales Laptop" demo item shape
  // (sys_id e212a942c0a80165008313c59764eea1 on dev310193). This item has
  // a NESTED "Optional Software" container wrapping per-app boolean
  // toggles (powerpoint / acrobat / photoshop / siebel) plus a free-text
  // "Additional software requirements". Exercises:
  //   - collectVariables() walking nested children
  //   - hint_exact_name path for boolean toggles
  //   - context_boolean fallback for the un-hinted Siebel toggle when the
  //     user context contains a negative phrase referring to it
  //   - hint passthrough into a multi-line text field
  // -------------------------------------------------------------------------
  function salesLaptopDemoItem(): ServiceNowCatalogItemDetail {
    return {
      sys_id: "sales_laptop",
      name: "Sales Laptop",
      variables: [
        {
          name: "optional_label",
          label: "Optional Software",
          type: "0",
          variables: [
            { name: "powerpoint", label: "Microsoft Powerpoint", type: "7" },
            { name: "acrobat", label: "Adobe Acrobat", type: "7" },
            { name: "photoshop", label: "Adobe Photoshop", type: "7" },
            { name: "siebel", label: "Siebel Client", type: "7" }
          ]
        },
        {
          name: "software_requirements",
          label: "Additional software requirements",
          type: "2"
        }
      ]
    };
  }

  it("prefills nested boolean toggles via exact-name hints (PowerPoint, Acrobat, Photoshop)", () => {
    const item = salesLaptopDemoItem();
    const { values, diagnostics } = computePrefillValues(item.variables, {
      prefillHints: { powerpoint: true, acrobat: true, photoshop: true }
    });
    expect(values).toMatchObject({
      powerpoint: true,
      acrobat: true,
      photoshop: true
    });
    expect(diagnostics.find(d => d.variableName === "powerpoint")?.source).toBe("hint_exact_name");
  });

  it("infers an un-hinted toggle to FALSE from a negative phrase in userContext (Siebel)", () => {
    const item = salesLaptopDemoItem();
    const { values, diagnostics } = computePrefillValues(item.variables, {
      userContext:
        "Joining sales next week, please install PowerPoint and Acrobat. No Siebel needed.",
      prefillHints: { powerpoint: true, acrobat: true }
    });
    expect(values.siebel).toBe(false);
    expect(diagnostics.find(d => d.variableName === "siebel")?.source).toBe("context_boolean");
  });

  it("passes a free-text software_requirements hint straight into the multi-line field", () => {
    const item = salesLaptopDemoItem();
    const requirements = "Please also install Siebel CRM client and Slack desktop app";
    const { values } = computePrefillValues(item.variables, {
      prefillHints: { software_requirements: requirements }
    });
    expect(values.software_requirements).toBe(requirements);
  });

  it("real-world combined Sales Laptop scenario fills all five fields", () => {
    const item = salesLaptopDemoItem();
    const { values } = computePrefillValues(item.variables, {
      userContext:
        "Joining the sales team next week and need a laptop. Please install PowerPoint and Adobe Acrobat. Also Photoshop would be useful for marketing decks. No Siebel needed.",
      prefillHints: {
        powerpoint: true,
        acrobat: true,
        photoshop: true,
        software_requirements: "Please also install Siebel CRM client and Slack desktop app"
      }
    });
    expect(values).toEqual({
      powerpoint: true,
      acrobat: true,
      photoshop: true,
      siebel: false,
      software_requirements: "Please also install Siebel CRM client and Slack desktop app"
    });
  });
});

describe("buildOrderFormAdaptiveCard with prefilledValues", () => {
  it("applies prefilled values to Input.ChoiceSet and Input.Text", () => {
    const item = iphoneItem();
    const { values: prefilled } = computePrefillValues(item.variables, {
      prefillHints: {
        color: "Black",
        storage: "256GB",
        carrier: "Verizon",
        model: "iPhone 15 Pro",
        justification: "Replacement for damaged phone"
      }
    });

    const card = buildOrderFormAdaptiveCard(item, prefilled);
    const body = card.body as Array<Record<string, unknown>>;
    const byId = Object.fromEntries(
      body.filter(b => typeof b.id === "string").map(b => [b.id as string, b])
    );

    expect(byId.color.value).toBe("Black");
    expect(byId.storage.value).toBe("256GB");
    expect(byId.carrier.value).toBe("Verizon");
    expect(byId.model.value).toBe("iPhone 15 Pro");
    expect(byId.justification.value).toBe("Replacement for damaged phone");
  });

  it("shows a prefill banner only when at least one field was prefilled", () => {
    const item = iphoneItem();

    const empty = buildOrderFormAdaptiveCard(item, {});
    const emptyBody = empty.body as Array<Record<string, unknown>>;
    expect(emptyBody.some(b => String(b.text ?? "").includes("prefilled"))).toBe(false);

    const filled = buildOrderFormAdaptiveCard(item, { color: "Black" });
    const filledBody = filled.body as Array<Record<string, unknown>>;
    expect(filledBody.some(b => String(b.text ?? "").includes("prefilled"))).toBe(true);
  });

  it("does not break when no prefilledValues argument is provided", () => {
    const item = iphoneItem();
    const card = buildOrderFormAdaptiveCard(item);
    expect(card.type).toBe("AdaptiveCard");
    const body = card.body as Array<Record<string, unknown>>;
    const colorInput = body.find(b => b.id === "color") as Record<string, unknown>;
    expect(colorInput.value).toBe("");
  });
});
