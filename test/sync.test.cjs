'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const os=require('node:os');
const crypto=require('node:crypto');
const {execFileSync,spawnSync}=require('node:child_process');
const root=path.resolve(__dirname,'..');
const hash=data=>crypto.createHash('sha256').update(data).digest('hex');
function setup(t){
  const tmp=fs.mkdtempSync(path.join(os.tmpdir(),'mea-pricing-sync-'));t.after(()=>fs.rmSync(tmp,{recursive:true,force:true}));
  const app=path.join(tmp,'app'),core=path.join(tmp,'core');fs.mkdirSync(app);fs.mkdirSync(path.join(core,'dist'),{recursive:true});
  for(const file of ['index.html','artist.html','pricing-lock.json','scripts','vendor'])fs.cpSync(path.join(root,file),path.join(app,file),{recursive:true});
  fs.copyFileSync(path.join(root,'vendor/pricing.js'),path.join(core,'dist/pricing.js'));
  const lock=JSON.parse(fs.readFileSync(path.join(root,'pricing-lock.json')));
  const manifest={apiVersion:lock.apiVersion,version:lock.version,file:'pricing.js',sha256:lock.sha256};
  fs.writeFileSync(path.join(core,'dist/manifest.json'),JSON.stringify(manifest));
  const git=(...args)=>execFileSync('git',args,{cwd:core,encoding:'utf8',stdio:['ignore','pipe','pipe']}).trim();
  git('init','-b','main');git('config','user.name','Pricing sync tests');git('config','user.email','tests@example.invalid');
  const commit=()=>{git('add','.');git('commit','-m','Fixture');return git('rev-parse','HEAD');};
  const initial=commit();
  const sync=sha=>spawnSync(process.execPath,[path.join(app,'scripts/sync-pricing.cjs'),core,sha],{encoding:'utf8'});
  return {app,core,git,commit,initial,sync,manifest};
}
test('sync imports exact committed bytes, resolves bootstrap, and is idempotent',t=>{
  const f=setup(t);const original=fs.readFileSync(path.join(f.core,'dist/pricing.js'));
  // Dirty working-tree files must never masquerade as the confirmed commit.
  fs.writeFileSync(path.join(f.core,'dist/pricing.js'),'uncommitted invalid bundle');
  fs.writeFileSync(path.join(f.core,'dist/manifest.json'),'{}');
  const before=fs.readFileSync(path.join(f.app,'artist.html'),'utf8');
  assert.equal(f.sync(f.initial).status,0);
  assert.deepEqual(fs.readFileSync(path.join(f.app,'vendor/pricing.js')),original);
  const lock=JSON.parse(fs.readFileSync(path.join(f.app,'pricing-lock.json')));
  assert.equal(lock.commit,f.initial);assert.equal(lock.bootstrapPending,false);
  assert.equal(f.sync(f.initial).status,0);
  assert.equal(fs.readFileSync(path.join(f.app,'artist.html'),'utf8'),before);
});
test('sync refuses an incorrect confirmed SHA and unsupported API',t=>{
  const f=setup(t);const previous=fs.readFileSync(path.join(f.app,'pricing-lock.json'),'utf8');
  assert.notEqual(f.sync('0'.repeat(40)).status,0);
  fs.writeFileSync(path.join(f.core,'dist/manifest.json'),JSON.stringify({...f.manifest,apiVersion:2}));
  assert.notEqual(f.sync(f.commit()).status,0);
  assert.equal(fs.readFileSync(path.join(f.app,'pricing-lock.json'),'utf8'),previous);
});
test('changed canonical bundle updates both consumers and increments product versions only once',t=>{
  const f=setup(t);const bundlePath=path.join(f.core,'dist/pricing.js');
  const source=fs.readFileSync(bundlePath,'utf8');
  // A distinct compatible release exercises the complete immutable import path.
  const next=source+'\n/* next compatible release fixture */\n';
  fs.writeFileSync(bundlePath,next);
  fs.writeFileSync(path.join(f.core,'dist/manifest.json'),JSON.stringify({...f.manifest,sha256:hash(next)}));
  const versionOf=file=>Number(fs.readFileSync(path.join(f.app,file),'utf8').match(file==='artist.html'?/class="version">v(\d+)/:/class="app-version" aria-label="Version">v(\d+)/)[1]);
  const before={artist:versionOf('artist.html'),customer:versionOf('index.html')};
  const sha=f.commit();assert.equal(f.sync(sha).status,0);assert.equal(f.sync(sha).status,0);
  assert.equal(versionOf('artist.html'),before.artist+1);assert.equal(versionOf('index.html'),before.customer+1);
  assert.equal(fs.readFileSync(path.join(f.app,'vendor/pricing.js'),'utf8'),next);
});
test('plugin release request accepts only the canonical repository and exact SHA',t=>{
  const f=setup(t);const envFile=path.join(f.app,'action-env');
  const file=path.join(f.app,'.pricing-release.json');
  const invoke=()=>spawnSync(process.execPath,[path.join(f.app,'scripts/read-release-request.cjs')],{encoding:'utf8',env:{...process.env,GITHUB_EVENT_NAME:'push',GITHUB_ENV:envFile}});
  fs.writeFileSync(file,JSON.stringify({repository:'gakkii415/tattoo-pricing-core',commit:f.initial}));
  assert.equal(invoke().status,0);
  assert.equal(fs.readFileSync(envFile,'utf8'),`SOURCE_COMMIT=${f.initial}\n`);
  fs.writeFileSync(file,JSON.stringify({repository:'other/repository',commit:f.initial}));
  assert.notEqual(invoke().status,0);
  fs.writeFileSync(file,JSON.stringify({repository:'gakkii415/tattoo-pricing-core',commit:f.initial+'\nEXTRA=bad'}));
  assert.notEqual(invoke().status,0);
  assert.equal(fs.readFileSync(envFile,'utf8'),`SOURCE_COMMIT=${f.initial}\n`);
});
