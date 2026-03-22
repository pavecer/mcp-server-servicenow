const [endpoint, key] = process.argv.slice(2);
const payload = {
  jsonrpc: "2.0",
  id: 1,
  method: "tools/call",
  params: {
    name: "validate_servicenow_configuration",
    arguments: {
      query: "laptop",
      forceClientCredentials: true,
      probeOrderNow: false,
      limit: 5
    }
  }
};
const res = await fetch(endpoint, {
  method: "POST",
  headers: {
    "content-type": "application/json",
    "x-functions-key": key
  },
  body: JSON.stringify(payload)
});
const bodyText = await res.text();
if (!res.ok) {
  console.error(`HTTP ${res.status}: ${bodyText}`);
  process.exit(1);
}
const body = JSON.parse(bodyText);
const text = body?.result?.content?.find(c => c.type === "text")?.text;
if (!text) {
  console.error("No text content in tool response");
  process.exit(1);
}
console.log(text);
