'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
const script=fs.readFileSync(path.join(__dirname,'../scripts/publish-pages.cjs'),'utf8');
const expected='a'.repeat(40);
const apiBase='https://api.github.com/repos/mea-tattoo/price-simulator/';
const liveBase='https://mea-tattoo.github.io/price-simulator/';

async function simulate({badFile=false,failedBuild=false}={}){
  const calls=[],messages=[],errors=[];
  let polls=0,checks=0;
  const process={env:{GITHUB_REPOSITORY:'mea-tattoo/price-simulator',GH_TOKEN:'test-token'}};
  const context={
    __dirname:'/fixture/scripts',Buffer,URL,process,
    console:{log:x=>messages.push(x),error:x=>errors.push(x)},
    setTimeout:fn=>fn(),
    require:name=>{
      if(name==='node:fs')return {readFileSync:file=>Buffer.from(path.basename(file))};
      if(name==='node:child_process')return {execFileSync:()=>expected};
      if(name==='./check-pricing.cjs')return release=>{assert.equal(release,true);checks++;};
      return require(name);
    },
    fetch:async (url,options={})=>{
      url=String(url);calls.push({url,options});
      if(url===apiBase+'pages')return {ok:true,json:async()=>({build_type:'legacy',source:{branch:'main',path:'/'},html_url:liveBase})};
      if(url===apiBase+'pages/builds'){
        assert.equal(options.method,'POST');
        return {ok:true,json:async()=>({url:'https://api.github.com/repositories/1340154172/pages/builds/latest'})};
      }
      if(url===apiBase+'pages/builds/latest'){
        polls++;
        return {ok:true,json:async()=>polls===1?{commit:'b'.repeat(40),status:'errored'}:{commit:expected,status:failedBuild?'errored':'built'}};
      }
      assert(url.startsWith(liveBase));
      assert.equal(options.headers,undefined,'Do not send the API token to the public website');
      const filename=path.basename(new URL(url).pathname);
      return {ok:true,arrayBuffer:async()=>Buffer.from(badFile?'stale':filename)};
    }
  };
  await vm.runInNewContext(script,context);
  return {calls,messages,errors,process,polls,checks};
}

test('publisher uses a fixed API endpoint, ignores unrelated builds, and verifies all live bytes',async()=>{
  const r=await simulate();
  assert.equal(r.process.exitCode,undefined);
  assert.equal(r.checks,1);assert.equal(r.polls,2);
  assert.equal(r.calls.filter(x=>x.url.startsWith(liveBase)).length,4);
  assert(r.messages[0].includes(expected));assert.deepEqual(r.errors,[]);
});
test('publisher refuses a failed build of the expected commit',async()=>{
  const r=await simulate({failedBuild:true});
  assert.equal(r.process.exitCode,1);assert.deepEqual(r.errors,['Pages build failed']);
  assert.equal(r.calls.filter(x=>x.url.startsWith(liveBase)).length,0);
});
test('publisher refuses stale deployed bytes',async()=>{
  const r=await simulate({badFile:true});
  assert.equal(r.process.exitCode,1);
  assert.match(r.errors[0],/Published index.html does not match/);
  assert.equal(r.messages.length,0);
});
