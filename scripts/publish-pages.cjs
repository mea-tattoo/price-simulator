'use strict';
// Keep the existing branch-based GitHub Pages publication method.
const fs=require('node:fs');
const path=require('node:path');
const assert=require('node:assert/strict');
const {execFileSync}=require('node:child_process');
const root=path.resolve(__dirname,'..');
const repo=process.env.GITHUB_REPOSITORY;
const token=process.env.GH_TOKEN;
assert.equal(repo,'mea-tattoo/price-simulator');assert(token,'GH_TOKEN required');
const expected=execFileSync('git',['rev-parse','HEAD'],{cwd:root,encoding:'utf8'}).trim();
const delay=ms=>new Promise(resolve=>setTimeout(resolve,ms));
async function api(route,method='GET'){
  const response=await fetch(`https://api.github.com/repos/${repo}/${route}`,{method,headers:{Authorization:`Bearer ${token}`,Accept:'application/vnd.github+json','X-GitHub-Api-Version':'2022-11-28'}});
  if(!response.ok)throw new Error(`GitHub ${method} ${route}: ${response.status}`);
  return response.json();
}
async function main(){
  require('./check-pricing.cjs')(true);
  const pages=await api('pages');
  assert.equal(pages.build_type,'legacy','Keep branch publication; inspect Pages settings before changing the pipeline');
  assert.equal(pages.source.branch,'main');assert.equal(pages.source.path,'/');
  // GITHUB_TOKEN pushes do not start Pages builds, so request it explicitly.
  const build=await api('pages/builds','POST');
  assert(build.url?.startsWith(`https://api.github.com/repos/${repo}/pages/builds/`));
  const route=build.url.split(`/repos/${repo}/`)[1];
  let built=false;
  for(let attempt=0;attempt<60;attempt++){
    const state=await api(route);
    if(state.status==='errored')throw new Error('Pages build failed');
    if(state.status==='built'){assert.equal(state.commit,expected,'Another commit was published');built=true;break;}
    await delay(10000);
  }
  assert(built,'Pages build timed out');
  const base=pages.html_url.endsWith('/')?pages.html_url:pages.html_url+'/';
  for(const file of ['index.html','artist.html','vendor/pricing.js','pricing-lock.json']){
    const expectedBytes=fs.readFileSync(path.join(root,file));
    let verified=false;
    for(let attempt=0;attempt<30;attempt++){
      const response=await fetch(new URL(`${file}?verify=${expected}`,base),{cache:'no-store'});
      if(response.ok&&Buffer.from(await response.arrayBuffer()).equals(expectedBytes)){verified=true;break;}
      await delay(10000);
    }
    assert(verified,`Published ${file} does not match confirmed build`);
  }
  console.log(`Verified Pages publication: ${base} (${expected})`);
}
main().catch(error=>{console.error(error.message);process.exitCode=1;});
