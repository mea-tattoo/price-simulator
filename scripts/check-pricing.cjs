'use strict';
const fs=require('node:fs');
const path=require('node:path');
const crypto=require('node:crypto');
const assert=require('node:assert/strict');
const vm=require('node:vm');
const root=path.resolve(__dirname,'..');
function check(release=false){
  const lock=JSON.parse(fs.readFileSync(path.join(root,'pricing-lock.json'),'utf8'));
  const source=fs.readFileSync(path.join(root,'vendor/pricing.js'));
  assert.equal(crypto.createHash('sha256').update(source).digest('hex'),lock.sha256,'Pricing bundle differs from lock');
  const sandbox={};vm.runInNewContext(source.toString(),sandbox);
  const engine=sandbox.MeaPricing;
  assert.equal(engine.apiVersion,1,'Consumer needs migration for this API');
  assert.equal(engine.version,lock.version);
  for(const name of ['base','rate','shapeFromRatio','calculate','maxAffordableLength','summarize'])assert.equal(typeof engine[name],'function',`Missing ${name}`);
  for(const file of ['index.html','artist.html']){
    const html=fs.readFileSync(path.join(root,file),'utf8');
    assert.equal((html.match(/src="vendor\/pricing\.js"/g)||[]).length,1,`${file} must load shared pricing once`);
    assert(!/const (?:RATE|BASE_BANDS)\s*=\s*[\[{]|Math\.round\(\w+\/1000\)|amount\s*\*=/.test(html),`${file} duplicates pricing`);
    assert(html.indexOf('src="vendor/pricing.js"')<html.indexOf('const pricing='));
    for(const [,js] of html.matchAll(/<script>([\s\S]*?)<\/script>/g))new vm.Script(js,{filename:file});
  }
  if(release){
    assert.equal(lock.repository,'mea-tattoo/pricing-core');
    assert.match(lock.commit,/^[0-9a-f]{40}$/,'Canonical repository must be created and pinned before release');
    assert.equal(lock.bootstrapPending,false,'Bootstrap must finish before release');
  }
  return lock;
}
if(require.main===module){const lock=check(process.argv.includes('--release'));console.log(`Pricing ${lock.version}: bundle, API and consumers OK`);}
module.exports=check;
