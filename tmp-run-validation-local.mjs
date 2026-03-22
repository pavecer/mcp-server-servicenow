const endpoint = 'http://localhost:7072/mcp';
let id = 1;
async function call(payload) {
  const res = await fetch(endpoint, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(payload)
  });
  const txt = await res.text();
  if (!res.ok) throw new Error(`HTTP ${res.status}: ${txt}`);
  return txt ? JSON.parse(txt) : {};
}
await call({ jsonrpc:'2.0', id:id++, method:'initialize', params:{ protocolVersion:'2025-06-18', capabilities:{}, clientInfo:{name:'local-validator',version:'1.0.0'} } });
const result = await call({ jsonrpc:'2.0', id:id++, method:'tools/call', params:{ name:'validate_servicenow_configuration', arguments:{ query:'laptop', forceClientCredentials:true, probeOrderNow:false, limit:5 } } });
const text = result?.result?.content?.find(c => c.type === 'text')?.text;
if (!text) throw new Error('No text output from tool');
console.log(text);
