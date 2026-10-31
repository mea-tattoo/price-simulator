'use strict';
const fs=require('node:fs');
const path=require('node:path');
const assert=require('node:assert/strict');
const root=path.resolve(__dirname,'..');
let commit;
if(process.env.GITHUB_EVENT_NAME==='workflow_dispatch'){
  commit=process.env.DISPATCH_SOURCE_COMMIT;
}else{
  assert.equal(process.env.GITHUB_EVENT_NAME,'push');
  const request=JSON.parse(fs.readFileSync(path.join(root,'.pricing-release.json'),'utf8'));
  assert.equal(request.repository,'gakkii415/tattoo-pricing-core');
  commit=request.commit;
}
assert.match(commit||'',/^[0-9a-f]{40}$/,'Confirmed SHA must be exactly 40 lowercase hexadecimal characters');
assert(process.env.GITHUB_ENV,'This script runs in GitHub Actions');
fs.appendFileSync(process.env.GITHUB_ENV,`SOURCE_COMMIT=${commit}\n`);
console.log(`Confirmed revision: ${commit}`);
