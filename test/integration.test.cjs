'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
const pricing=require('../vendor/pricing.js');
const root=path.resolve(__dirname,'..');
function functionSource(file,start,end){const text=fs.readFileSync(path.join(root,file),'utf8');return text.slice(text.indexOf(start),text.indexOf(end,text.indexOf(start)));}
function element(value=''){
  return {value:String(value),textContent:'',innerHTML:'',hidden:false,classList:{toggle(){},add(){},remove(){}},dataset:{}};
}
function runArtist(input){
  const fields={};for(const key of ['long','short','whitespace','complexity','color'])fields['.'+key]=element(input[key]??'');
  for(const key of ['validation','longHelp','shortRatio','shortHelp','whitespaceHelp','complexityHelp','colorHelp'])fields['.'+key]=element();
  const card={querySelector:key=>{assert(fields[key],key);return fields[key];},dataset:{}};
  const context={pricing,base:pricing.base,shapeFromRatio:pricing.shapeFromRatio,rate:pricing.rate,baseBandsHtml:()=>'',shapeRowsHtml:()=>'',optionRowsHtml:()=>'',refreshSummary(){},card};
  vm.runInNewContext(functionSource('artist.html','function normalizeNumber(','const LABEL_EN=')+'\nrecalc(card);',context);
  return card;
}
function runCustomer(input){
  const fields={};
  const context={pricing,baseFromLength:pricing.base,sizeLength:element(input.long),sizeShort:element(input.short),sizeComplexity:element(input.complexity),sizeColor:element(input.color),updateRangeTrack(){},setSizeDimensionDisplay(){},$:id=>fields[id]??=element(),showSizePlaceholder(){this.result='placeholder';},showSizeInquiry(){this.result='inquiry';},showSizeEstimate(value){this.result=value;}};
  // Functions called as plain globals should write captured state, independent of strict-mode this.
  context.showSizePlaceholder=()=>{context.result='placeholder';};context.showSizeInquiry=()=>{context.result='inquiry';};context.showSizeEstimate=n=>{context.result=n;};
  vm.runInNewContext(functionSource('index.html','function recalcSize(){','[sizeLength,sizeShort]')+'\nrecalcSize();',context);
  return context.result;
}
test('bundle integrity, script ordering, syntax and stable API',()=>require('../scripts/check-pricing.cjs')());
test('all 2700 artist combinations flow through the shared calculation without a UI adjustment',()=>{
  let count=0;
  for(const band of pricing.BASE_BANDS)for(const shape of Object.keys(pricing.RATE.shape))for(const whitespace of Object.keys(pricing.RATE.whitespace))for(const complexity of Object.keys(pricing.RATE.complexity))for(const color of Object.keys(pricing.RATE.color)){
    const long=band.max,short=Math.max(1,Math.round(long*pricing.SHAPE_RATIO[shape]));
    const input={long,short,whitespace,complexity,color};
    assert.equal(runArtist(input)._calc.rounded,pricing.calculate(input,'artist').rounded);count++;
  }
  assert.equal(count,pricing.BASE_BANDS.length*Object.keys(pricing.RATE.shape).length*Object.keys(pricing.RATE.whitespace).length*Object.keys(pricing.RATE.complexity).length*Object.keys(pricing.RATE.color).length);
});
test('customer size renderer uses the shared customer profile including no whitespace discount',()=>{
  for(const band of pricing.BASE_BANDS)for(const shape of Object.keys(pricing.RATE.shape))for(const complexity of Object.keys(pricing.RATE.complexity))for(const color of Object.keys(pricing.RATE.color)){
    const long=band.max,short=Math.max(1,Math.round(long*pricing.SHAPE_RATIO[shape]));
    const input={long,short,complexity,color};
    assert.equal(runCustomer(input),pricing.calculate(input,'customer').rounded);
  }
});
test('invalid, inquiry, blank-selection and normalized-number behavior stays intact',()=>{
  assert.equal(runArtist({long:'',short:40})._calc,null);
  assert.equal(runArtist({long:80,short:81})._calc,null);
  const unsupported=Math.max(...pricing.BASE_BANDS.map(band=>band.max))+1;
  if(unsupported<=300)assert.equal(runArtist({long:unsupported,short:100}).dataset.special,'1');
  assert.equal(runArtist({long:80.4,short:50.4})._calc.rounded,pricing.calculate({long:80,short:50},'artist').rounded);
  assert.equal(runCustomer({long:80,short:50,complexity:'',color:'oneToThree'}),'placeholder');
  assert.equal(runCustomer({long:unsupported,short:50,complexity:'standard',color:'oneToThree'}),'inquiry');
  assert.equal(runCustomer({long:80,short:90,complexity:'standard',color:'oneToThree'}),'placeholder');
});
test('budget controller delegates the selected options to the canonical function',()=>{
  let received;
  const context={pricing:{maxAffordableLength:(budget,options)=>{received={budget,options};return 123;}},budgetShape:element('narrow'),budgetComplexity:element('complex'),budgetColor:element('sevenPlus')};
  vm.runInNewContext(functionSource('index.html','function maxAffordableLength(','function showBudgetPlaceholder()')+'\nresult=maxAffordableLength(45000);',context);
  assert.equal(context.result,123);
  assert.deepEqual(JSON.parse(JSON.stringify(received)),{budget:45000,options:{shape:'narrow',complexity:'complex',color:'sevenPlus'}});
});
test('both summary languages render the canonical subtotal, discount and total',()=>{
  const elements={};const cards=[{_calc:{rounded:17000},querySelector:()=>({checked:false}),dataset:{}},{_calc:{rounded:25000},querySelector:()=>({checked:false}),dataset:{}}];
  const domElement=()=>({...element(),append(){},appendChild(){}});
  const context={pricing,host:{querySelectorAll:()=>cards},document:{getElementById:id=>elements[id]??=domElement(),querySelector:id=>elements[id]??=domElement(),createElement:domElement},breakdownLinesJa:()=>[],breakdownLinesEn:()=>[],money:n=>String(n)};
  const source=functionSource('artist.html','function refreshSummary(){','if(!restoreSavedState())');
  vm.runInNewContext(source+'\nrefreshSummary();',context);
  const expected=pricing.summarize(cards.map(card=>({calc:card._calc,combined:false})));
  for(const language of ['Ja','En']){
    assert.equal(elements['subtotal'+language].textContent,String(expected.subtotal));
    assert.equal(elements['total'+language].textContent,String(expected.total));
    assert.equal(elements[`#discountRow${language} strong`].textContent,`-${expected.discount}`);
  }
});
