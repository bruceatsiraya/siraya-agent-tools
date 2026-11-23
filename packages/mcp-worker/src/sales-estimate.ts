export const estimatePanel = `<section id="estimate"><h2>價格試算</h2>
<style>
#estimate .ec-layout{display:grid;grid-template-columns:minmax(260px,2fr) minmax(0,3fr);gap:24px;align-items:start}
#estimate .ec-box{background:#f7f9fc;border:1px solid #d6e0ed;border-radius:10px;padding:16px;min-width:0}
#estimate .ec-scope{display:flex;align-items:end;flex-wrap:wrap;gap:12px;margin:12px 0 18px}
#estimate label{display:grid;gap:4px}#estimate summary{cursor:pointer;font-weight:650;margin-bottom:12px}
#estimate-editor>div{display:grid;grid-template-columns:minmax(0,1.25fr) minmax(0,1fr) auto;align-items:end;gap:8px;padding:10px 0;border-top:1px solid #dce4ef}
#estimate-editor input,#estimate-amount{width:100%;box-sizing:border-box;min-width:0}
#estimate-editor label{font-size:13px}#estimate #estimate-slider{display:block;width:100%;max-width:none;box-sizing:border-box;margin:18px 0}
#estimate-chart{display:block;width:100%;height:auto}#estimate [hidden]{display:none}
#estimate-results{display:grid;grid-template-columns:repeat(auto-fit,minmax(105px,1fr));gap:8px}#estimate-results div{background:white;border:1px solid #d6e0ed;border-radius:8px;padding:10px;overflow-wrap:anywhere}#estimate-results strong{display:block;color:#116d63;font-size:1.2rem}
@media(max-width:800px){#estimate .ec-layout{grid-template-columns:1fr}}
</style><div class="ec-scope"><label><span data-ec="scope"></span><select id="estimate-scope"><option value="family">模型系列</option><option value="model">單模型</option><option value="all">總體消費</option></select></label>
<label id="estimate-target-wrap"><span data-ec="target"></span><select id="estimate-target"></select></label></div><div class="ec-layout">
<details open class="ec-box"><summary data-ec="tiers"></summary><div id="estimate-editor"></div><button type="button" id="estimate-add" data-ec="add"></button></details>
<div class="ec-box"><label>每月原價消費（USD）<input id="estimate-amount" form="estimate-only" type="number" min="0" max="1000000000" step=".01" value="75000"></label>
<input id="estimate-slider" type="range" min="0" max="200000" step=".01" value="75000" aria-label="Monthly list-price spend (USD)">
<div id="estimate-marks" style="display:flex;flex-wrap:wrap;gap:.5rem"></div><p id="estimate-note"></p><div id="estimate-results"></div>

<p id="estimate-legend"></p><canvas id="estimate-chart" width="760" height="220" role="img"></canvas></div></div></section>`;

export function estimatePayment(base: number, tiers: {end:number;factor:number}[]) {
  let start=0, payment=0;
  for(const {end,factor} of tiers){
    payment+=Math.max(0,Math.min(base,end)-start)*factor;
    start=end;
  }
  return payment;
}

export const estimateScript = `
${estimatePayment.toString()}
const amount=$('#estimate-amount'),slider=$('#estimate-slider');
const estimateRates={Claude:[.9,.74,.82],GPT:[.8,.64,.72],Gemini:[.85,.71,.78]};
const estimateScope=$('#estimate-scope'),estimateTarget=$('#estimate-target');
const familyName=m=>Object.keys(estimateRates).find(name=>name.toLowerCase()===String(m.family).toLowerCase())||m.family||'Other';
const estimatePlans=new Map();
const ecText=(zh,en)=>document.documentElement.lang==='en'?en:zh;
function estimateLabels(){
  const labels={scope:['消費範圍','Usage scope'],target:estimateScope.value==='model'?['模型','Model']:['模型系列','Model family'],tiers:['分段計價設定','Pricing tiers'],add:['新增檔位','Add tier']};
  for(const el of document.querySelectorAll('[data-ec]'))el.textContent=ecText(...labels[el.dataset.ec]);
  [['模型系列','Model family'],['單模型','Single model'],['總體消費','Total spend']].forEach((pair,i)=>estimateScope.options[i].textContent=ecText(...pair));
}
let estimatePlan,estimateDragging=false;
function loadEstimateTarget(){
  const key=JSON.stringify([estimateScope.value,estimateTarget.value]);
  if(!estimatePlans.has(key)){
    const model=models.find(m=>m.id===estimateTarget.value);
    const family=estimateScope.value==='model'&&model?familyName(model):estimateTarget.value;
    const factors=Object.hasOwn(estimateRates,family)?estimateRates[family]:Array(3).fill(estimateScope.value==='model'?model?.base??1:1);
    estimatePlans.set(key,factors.map((factor,i)=>({end:[50000,100000,Infinity][i],factor})));
  }
  estimatePlan=estimatePlans.get(key);drawEstimateEditor();renderEstimate();
}
function loadEstimateScope(){
  const choices=estimateScope.value==='model'?models.map(m=>m.id):estimateScope.value==='family'?[...new Set([...Object.keys(estimateRates),...models.map(familyName)])]:['Total'];
  estimateTarget.replaceChildren(...choices.map(name=>new Option(name,name)));
  $('#estimate-target-wrap').hidden=estimateScope.value==='all';loadEstimateTarget();
}
function drawEstimateEditor(){
  estimateLabels();const editor=$('#estimate-editor');editor.replaceChildren();
  estimatePlan.forEach((row,i)=>{
    const line=document.createElement('div');
    function field(label,value,onChange){
      const wrap=document.createElement('label'),input=document.createElement('input');
      wrap.textContent=label;input.type='number';input.step='any';input.setAttribute('form','estimate-only');input.value=String(value);
      input.oninput=()=>{onChange(input.valueAsNumber);renderEstimate()};wrap.append(input);line.append(wrap);
    }
    if(i<estimatePlan.length-1)field(ecText('第 '+(i+1)+' 檔上限（USD）','Tier '+(i+1)+' ceiling (USD)'),row.end,v=>row.end=v);
    else line.append(ecText('最後一檔 · 無上限','Final tier · No ceiling'));
    field(ecText('實付比例（%）','Pay rate (%)'),Number((row.factor*100).toFixed(8)),v=>row.factor=v/100);
    if(i<estimatePlan.length-1){const del=document.createElement('button');del.type='button';del.textContent=ecText('移除','Remove');del.onclick=()=>{estimatePlan.splice(i,1);drawEstimateEditor();renderEstimate()};line.append(del)}
    editor.append(line);
  });
}
$('#estimate-add').onclick=()=>{
  const last=estimatePlan.at(-1),prior=estimatePlan.at(-2)?.end||0;
  estimatePlan.splice(-1,0,{end:prior+50000,factor:last.factor});drawEstimateEditor();renderEstimate();
};
estimateScope.onchange=loadEstimateScope;estimateTarget.onchange=loadEstimateTarget;
function renderEstimate(){
  const spend=amount.valueAsNumber,en=document.documentElement.lang==='en';
  const ordered=estimatePlan.every((t,i)=>Number.isFinite(t.factor)&&t.factor>=0&&t.factor<=1&&(i===estimatePlan.length-1||Number.isFinite(t.end)&&t.end<1e9&&t.end>(estimatePlan[i-1]?.end??0)));
  const valid=ordered&&Number.isFinite(spend)&&spend>=0&&spend<=1e9;
  const max=Math.min(1e9,Math.max(1000,ordered?(estimatePlan.at(-2)?.end??100000)*2:200000,valid?Math.ceil(spend):0));
  if(valid){slider.max=String(max);slider.value=amount.value}
  const ends=estimatePlan.map(t=>t.end),tier=ends.findIndex(end=>spend<=end);
  const rate=v=>en?Number((v*100).toFixed(2))+'%':Number((v*10).toFixed(3))+' 折';
  const money=new Intl.NumberFormat('en-US',{style:'currency',currency:'USD'});
  $('#estimate-note').textContent=!ordered?(en?'Enter increasing positive ceilings below $1 billion and rates from 0 to 100%.':'門檻須遞增且介於 0 和 10 億之間，實付比例須為 0～100%。'):valid?(en?'Current tier '+(tier+1):'目前位於第 '+(tier+1)+' 檔'):(en?'Enter a valid spend amount.':'請輸入有效的消費金額。');
  const pay=estimatePayment(spend,estimatePlan);
  const metrics=[[ecText('當前檔折扣','Current tier rate'),valid?rate(estimatePlan[tier].factor):'—'],[ecText('累計綜合折扣','Blended rate'),valid&&spend?rate(pay/spend):'—'],[ecText('累計實付','Estimated payment'),valid?money.format(pay):'—']];
  $('#estimate-results').replaceChildren(...metrics.map(([name,value])=>{
    const card=document.createElement('div'),valueEl=document.createElement('strong');
    valueEl.textContent=value;card.append(name,valueEl);return card;
  }));
  const legend=en?'Blue · Current tier rate / Green · Blended rate':'藍線 · 當前檔折扣 ／ 綠線 · 累計綜合折扣';
  $('#estimate-legend').textContent=legend;
  const canvas=$('#estimate-chart'),ctx=canvas.getContext('2d');
  canvas.setAttribute('aria-label',estimateTarget.value+' · '+legend);
  ctx.clearRect(0,0,760,220);
  const marks=$('#estimate-marks');marks.replaceChildren();
  slider.style.background='';
  if(ordered){
    const stops=ends.slice(0,-1).map(v=>100*v/max);
    slider.style.appearance='none';slider.style.height='10px';slider.style.borderRadius='6px';
    slider.style.background='linear-gradient(to right,'+[0,...stops].map((start,i)=>(i%2?'#82c6b9':'#a6c8eb')+' '+start+'% '+(stops[i]??100)+'%').join(',')+')';
    ends.slice(0,-1).forEach((v,i)=>{const b=document.createElement('button');b.type='button';b.textContent=(en?'Tier '+(i+1):'第 '+(i+1)+' 檔')+' ≤ $'+v.toLocaleString();b.onclick=()=>{amount.value=String(v);renderEstimate()};marks.append(b)});
  }
  if(!valid)return;
  const rates=estimatePlan.map(t=>t.factor),schedule=estimatePlan;
  const x=v=>48+655*v/max,y=v=>180-v*155;
  ctx.font='13px system-ui';ctx.fillStyle='#52647b';
  for(const f of [0,.25,.5,.75,1])ctx.fillText(rate(f),0,y(f)+4);
  for(const v of [0,max])ctx.fillText('$'+v.toLocaleString('en-US'),x(v)-12,208);
  ctx.lineWidth=3;ctx.strokeStyle='#357bc0';ctx.beginPath();ctx.moveTo(x(0),y(rates[0]));
  schedule.forEach(({end,factor},i)=>{ctx.lineTo(x(Math.min(end,max)),y(factor));if(i<schedule.length-1)ctx.lineTo(x(end),y(rates[i+1]))});
  ctx.stroke();
  const blend=v=>v?estimatePayment(v,schedule)/v:rates[0];
  ctx.strokeStyle='#116d63';ctx.beginPath();ctx.moveTo(x(0),y(rates[0]));
  for(const [i,end] of [...ends.slice(0,-1),max].entries()){
    const start=i?ends[i-1]:0;
    for(let j=1;j<=50;j++){const v=start+(end-start)*j/50;ctx.lineTo(x(v),y(blend(v)))}
  }
  ctx.stroke();
  for(const [f,color] of [[rates[tier],'#357bc0'],[blend(spend),'#116d63']]){
    ctx.fillStyle=color;ctx.beginPath();ctx.arc(x(spend),y(f),4,0,Math.PI*2);ctx.fill();
  }
}
amount.oninput=renderEstimate;
slider.onpointerdown=()=>estimateDragging=true;
window.addEventListener('pointerup',()=>estimateDragging=false);
slider.onpointercancel=()=>estimateDragging=false;
slider.oninput=()=>{
  const raw=Number(slider.value),tol=Number(slider.max)*.017;
  const nearest=estimatePlan.slice(0,-1).reduce((best,t)=>Math.abs(raw-t.end)<Math.abs(raw-best)?t.end:best,Infinity);
  amount.value=String(estimateDragging&&Math.abs(raw-nearest)<=tol?nearest:raw);
  renderEstimate();
};
new MutationObserver(()=>{drawEstimateEditor();renderEstimate()}).observe(document.documentElement,{attributes:true,attributeFilter:['lang']});
loadEstimateScope();
`;
