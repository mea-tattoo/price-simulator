'use strict';
// Frozen v1 oracle extracted from the original HTML before the shared engine migration.
// Never regenerate this fixture to accept a fee change. Add a separately versioned baseline.
const artist = (() => {
const RATE={
  shape:{
    veryNarrow:{XS:-20,S:-20,M:-30,L:-30},
    narrow:{XS:0,S:-10,M:-15,L:-15},
    somewhat:{XS:0,S:0,M:-8,L:-8},
    square:{XS:0,S:0,M:0,L:0}
  },
  whitespace:{
    notApplicable:{XS:0,S:0,M:0,L:0},
    large:{XS:0,S:-30,M:-30,L:-30},
    half:{XS:0,S:-10,M:-15,L:-15},
    some:{XS:0,S:0,M:-10,L:-10},
    none:{XS:0,S:0,M:0,L:0}
  },
  complexity:{
    verySimple:{XS:0,S:-15,M:-15,L:-20},
    simple:{XS:0,S:0,M:-10,L:-15},
    standard:{XS:0,S:0,M:0,L:0},
    complex:{XS:0,S:10,M:5,L:5},
    veryComplex:{XS:10,S:15,M:10,L:25}
  },
  color:{
    oneToThree:{XS:0,S:0,M:0,L:0},
    fourToSix:{XS:0,S:5,M:5,L:10},
    sevenPlus:{XS:10,S:10,M:10,L:20}
  }
};

const BASE_BANDS=[
  {size:'XXS',min:1,max:9,price:13000},
  {size:'XS',min:10,max:44,price:17000},
  {size:'XS',min:45,max:49,price:22000},
  {size:'S',min:50,max:75,price:25000},
  {size:'S',min:76,max:90,price:33000},
  {size:'M',min:91,max:109,price:42000},
  {size:'M',min:110,max:150,price:52000},
  {size:'M',min:151,max:180,price:62000},
  {size:'L',min:181,max:230,price:80000}
];

function base(mm){
  const band=BASE_BANDS.find(x=>mm>=x.min&&mm<=x.max);
  return band?{...band}:{special:true};
}

function shapeFromRatio(r){
  if(r<=.34)return'veryNarrow';
  if(r<=.6)return'narrow';
  if(r<=.85)return'somewhat';
  return'square';
}

function rate(type,val,size){
  if(size==='XXS')return 0;
  return RATE[type]?.[val]?.[size]??0;
}


function calculate(input) {
  const {long,short}=input;
  const b=long?base(long):null;
  const invalid=!long||!short||short>long;
  let shape=null,shapeRate=0;
  if(long&&short&&!invalid&&b&&!b.special){
    shape=shapeFromRatio(short/long);
    shapeRate=rate('shape',shape,b.size);
  }
  const whitespace=input.whitespace??'';
  const complexity=input.complexity??'';
  const color=input.color??'';
  let calc=null;
  if(!invalid&&b&&!b.special){
    const whitespaceRate=rate('whitespace',whitespace,b.size);
    const complexityRate=rate('complexity',complexity,b.size);
    const colorRate=rate('color',color,b.size);
    const afterShape=b.price*(1+shapeRate/100);
    const afterWhitespace=afterShape*(1+whitespaceRate/100);
    const afterComplexity=afterWhitespace*(1+complexityRate/100);
    const raw=afterComplexity*(1+colorRate/100);
    const rounded=Math.max(0,Math.round(raw/1000)*1000);
    calc={
      long,short,size:b.size,bandMin:b.min,bandMax:b.max,basePrice:b.price,
      shape,shapeRate,whitespace,whitespaceRate,complexity,complexityRate,color,colorRate,
      shapeAmount:afterShape-b.price,
      whitespaceAmount:afterWhitespace-afterShape,
      complexityAmount:afterComplexity-afterWhitespace,
      colorAmount:raw-afterComplexity,
      afterShape,afterWhitespace,afterComplexity,raw,rounded
    };
  }


  return calc;
}
return {BASE_BANDS,RATE,base,rate,shapeFromRatio,calculate};
})();
const customer = (() => {
const RATE={
  shape:{
    veryNarrow:{XS:-20,S:-20,M:-30,L:-30},
    narrow:{XS:0,S:-10,M:-15,L:-15},
    somewhat:{XS:0,S:0,M:-8,L:-8},
    square:{XS:0,S:0,M:0,L:0}
  },
  complexity:{
    verySimple:{XS:0,S:-15,M:-15,L:-20},
    simple:{XS:0,S:0,M:-10,L:-15},
    standard:{XS:0,S:0,M:0,L:0},
    complex:{XS:0,S:10,M:5,L:5},
    veryComplex:{XS:10,S:15,M:10,L:25}
  },
  color:{
    oneToThree:{XS:0,S:0,M:0,L:0},
    fourToSix:{XS:0,S:5,M:5,L:10},
    sevenPlus:{XS:10,S:10,M:10,L:20}
  }
};

const SHAPE_RATIO={square:1,somewhat:.75,narrow:.5,veryNarrow:1/3};

function baseFromLength(mm){
  if(mm<=9)return {size:'XXS',price:13000};
  if(mm<=44)return {size:'XS',price:17000};
  if(mm<=49)return {size:'XS',price:22000};
  if(mm<=75)return {size:'S',price:25000};
  if(mm<=90)return {size:'S',price:33000};
  if(mm<=109)return {size:'M',price:42000};
  if(mm<=150)return {size:'M',price:52000};
  if(mm<=180)return {size:'M',price:62000};
  if(mm<=230)return {size:'L',price:80000};
  return {special:true};
}

function rate(type,value,size){
  if(size==='XXS')return 0;
  return RATE[type]?.[value]?.[size]??0;
}


function shapeFromDimensions(longMm,shortMm){
  const ratio=shortMm/longMm;
  if(ratio<=0.34)return 'veryNarrow';
  if(ratio<=0.60)return 'narrow';
  if(ratio<=0.85)return 'somewhat';
  return 'square';
}


function calculate(input) {
  const longMm=input.long;
  const shortMm=input.short;
  if(shortMm>longMm)return null;
  const base=baseFromLength(longMm);
  if(base.special)return null;
  if(!input.complexity||!input.color)return null;
  const shape=shapeFromDimensions(longMm,shortMm);
  let amount=base.price;
  amount*=1+rate('shape',shape,base.size)/100;
  amount*=1+rate('complexity',input.complexity,base.size)/100;
  amount*=1+rate('color',input.color,base.size)/100;
  return {raw:amount,rounded:Math.round(amount/1000)*1000,shape};
}
function budgetFunctions(options) {
  const budgetShape={value:options.shape};
  const budgetComplexity={value:options.complexity};
  const budgetColor={value:options.color};
function calculatedBudgetPrice(longMm){
  const base=baseFromLength(longMm);
  if(base.special)return Infinity;
  let amount=base.price;
  amount*=1+rate('shape',budgetShape.value,base.size)/100;
  amount*=1+rate('complexity',budgetComplexity.value,base.size)/100;
  amount*=1+rate('color',budgetColor.value,base.size)/100;
  return Math.round(amount/1000)*1000;
}

function maxAffordableLength(budgetValue){
  let max=0;
  for(let mm=1;mm<=230;mm++)if(calculatedBudgetPrice(mm)<=budgetValue)max=mm;
  return max;
}


  return {calculatedBudgetPrice,maxAffordableLength};
}
return {RATE,SHAPE_RATIO,baseFromLength,shapeFromDimensions,calculate,
  budgetPrice:(long,options)=>budgetFunctions(options).calculatedBudgetPrice(long),
  maxAffordableLength:(budget,options)=>budgetFunctions(options).maxAffordableLength(budget)};
})();
function summarize(entries) {
  let subtotal=0;
  let complete=true;
  entries.forEach((entry,i)=>{
    const c=entry.calc;
    const combined=i>0&&entry.combined;
    if(!combined){
      if(!c)complete=false;
      else subtotal+=c.rounded;
    }
  });
  const separatelyPricedCount=entries.filter((entry,i)=>i===0||!entry.combined).length;
  const discount=separatelyPricedCount>=2?5000:0;
  return {subtotal,discount,total:Math.max(0,subtotal-discount),complete,separatelyPricedCount};
}
module.exports={artist,customer,summarize};
