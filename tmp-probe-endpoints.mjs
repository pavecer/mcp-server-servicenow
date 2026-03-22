const [base, key] = process.argv.slice(2);
const paths = ['/mcp', '/api/mcp', '/mcp/', '/api/mcp/'];
const payload = { jsonrpc:'2.0', id:1, method:'initialize', params:{ protocolVersion:'2025-06-18', capabilities:{}, clientInfo:{name:'probe',version:'1.0.0'} } };
for (const p of paths) {
  const url = base + p;
  try {
    const res = await fetch(url, { method:'POST', headers:{'content-type':'application/json','x-functions-key':key}, body: JSON.stringify(payload)});
    const txt = await res.text();
    console.log(`${p} => ${res.status} ${txt.slice(0,120).replace(/\n/g,' ')}`);
  } catch (e) {
    console.log(`${p} => ERROR ${e.message}`);
  }
}
