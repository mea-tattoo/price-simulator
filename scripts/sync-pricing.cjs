'use strict';
// Called only after the user confirms a concrete canonical revision.
const fs=require('node:fs');
const path=require('node:path');
const assert=require('node:assert/strict');
const crypto=require('node:crypto');
const {execFileSync}=require('node:child_process');
const root=path.resolve(__dirname,'..');
const canonical=path.resolve(process.argv[2]||'');
const commit=process.argv[3];
assert.match(commit||'',/^[0-9a-f]{40}$/,'Pass the exact confirmed 40-character SHA');
assert.equal(execFileSync('git',['rev-parse','HEAD'],{cwd:canonical,encoding:'utf8'}).trim(),commit,'Checkout does not match confirmed SHA');
// Read the confirmed Git objects, never uncommitted working-tree content.
const manifest=JSON.parse(execFileSync('git',['show',`${commit}:dist/manifest.json`],{cwd:canonical,encoding:'utf8'}));
const bundle=execFileSync('git',['show',`${commit}:dist/pricing.js`],{cwd:canonical});
assert.equal(manifest.apiVersion,1,'Breaking API change: update the consumer adapter before release');
assert.equal(crypto.createHash('sha256').update(bundle).digest('hex'),manifest.sha256,'Canonical build differs from manifest');
const previous=JSON.parse(fs.readFileSync(path.join(root,'pricing-lock.json'),'utf8'));
const next={repository:'mea-tattoo/pricing-core',commit,version:manifest.version,apiVersion:manifest.apiVersion,sha256:manifest.sha256,bootstrapPending:false};
const changed=previous.sha256!==next.sha256;
fs.mkdirSync(path.join(root,'vendor'),{recursive:true});
fs.writeFileSync(path.join(root,'vendor/pricing.js'),bundle);
fs.writeFileSync(path.join(root,'pricing-lock.json'),JSON.stringify(next,null,2)+'\n');
// A pricing update bumps each UI's own vN exactly once. Retry/no-op does not.
if(changed){
  for(const [file,pattern] of [['index.html',/(class="app-version" aria-label="Version">v)(\d+)(<\/div>)/],['artist.html',/(class="version">v)(\d+)(<\/div>)/]]){
    const target=path.join(root,file);const html=fs.readFileSync(target,'utf8');
    assert(pattern.test(html),`Missing product version: ${file}`);
    fs.writeFileSync(target,html.replace(pattern,(_,start,n,end)=>`${start}${Number(n)+1}${end}`));
  }
}
require('./check-pricing.cjs')(true);
console.log(`Imported ${next.version} from ${commit}`);
