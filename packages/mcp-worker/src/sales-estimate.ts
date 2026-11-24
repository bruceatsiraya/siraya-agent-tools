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
<details open class="ec-box"><summary data-ec="tiers"></summary><label><span data-ec="mode"></span><select id="estimate-mode"><option value="tiers">分段階梯 / Tiers</option><option value="linear">無極階梯 / Continuous</option></select></label>
<div id="estimate-linear" hidden><label><span data-ec="threshold"></span><input type="number" id="estimate-limit" form="estimate-only" step="any"></label><label><span data-ec="average"></span><input type="number" id="estimate-average" form="estimate-only" step="any" min=".5" max="1"></label></div>
<small id="estimate-save" role="status"></small><div id="estimate-editor"></div><button type="button" id="estimate-add" data-ec="add"></button></details>
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
const mode=$('#estimate-mode'),limit=$('#estimate-limit'),average=$('#estimate-average');
const estimateCustomer=()=>$('#customer').value.trim();
const recordKey=()=> 'siraya:calculator:v1:'+JSON.stringify([owner,estimateCustomer(),estimateScope.value,estimateTarget.value]);
function readEstimate(key){try{return JSON.parse(localStorage.getItem(key)||'null')}catch{return null}}
const validRows=rows=>Array.isArray(rows)&&rows.length>0&&rows.every((t,i)=>t&&Number.isFinite(t.factor)&&t.factor>=0&&t.factor<=1&&(i===rows.length-1?t.end===Infinity:Number.isFinite(t.end)&&t.end<1e9&&t.end>(rows[i-1]?.end??0)));
function saveEstimate(){
  if(!estimateCustomer()||!validRows(estimatePlan)||!validCurve())return;
  try{
    localStorage.setItem(recordKey(),JSON.stringify({rows:estimatePlan,mode:mode.value,limit:limit.valueAsNumber,average:average.valueAsNumber}));
    $('#estimate-save').textContent=ecText('已儲存至此瀏覽器','Saved in this browser');
  }catch{$('#estimate-save').textContent=ecText('瀏覽器無法儲存設定','Browser storage unavailable')}
}
function validCurve(){return limit.valueAsNumber>0&&limit.valueAsNumber<=1e9&&average.valueAsNumber>=.5&&average.valueAsNumber<=1}
function editEstimate(){saveEstimate();renderEstimate()}

const ecText=(zh,en)=>document.documentElement.lang==='en'?en:zh;
function estimateLabels(){
  const labels={mode:['計價方式','Pricing mode'],threshold:['目標原價用量（USD）','Target spend (USD)'],average:['目標綜合實付比例（0.5–1）','Target blended pay rate (0.5–1)'],scope:['消費範圍','Usage scope'],target:estimateScope.value==='model'?['模型','Model']:['模型系列','Model family'],tiers:['分段計價設定','Pricing tiers'],add:['新增檔位','Add tier']};
  for(const el of document.querySelectorAll('[data-ec]'))el.textContent=ecText(...labels[el.dataset.ec]);
  [['模型系列','Model family'],['單模型','Single model'],['總體消費','Total spend']].forEach((pair,i)=>estimateScope.options[i].textContent=ecText(...pair));
}
let estimatePlan,estimateDragging=false;
function loadEstimateTarget(){
  const saved=estimateCustomer()?readEstimate(recordKey()):null;
  const model=models.find(m=>m.id===estimateTarget.value);
  const family=estimateScope.value==='model'&&model?familyName(model):estimateTarget.value;
  const factors=Object.hasOwn(estimateRates,family)?estimateRates[family]:Array(3).fill(estimateScope.value==='model'?model?.base??1:1);
  const restored=Array.isArray(saved?.rows)?saved.rows.map((t,i)=>({...t,end:i===saved.rows.length-1?Infinity:t?.end})):null;
  estimatePlan=validRows(restored)?restored:factors.map((factor,i)=>({end:[50000,100000,Infinity][i],factor}));
  mode.value=saved?.mode==='linear'?'linear':'tiers';limit.value=saved?.limit??100000;average.value=saved?.average??.8;
  if(!validCurve()){limit.value=100000;average.value=.8}
  $('#estimate-save').textContent=estimateCustomer()?ecText('依客戶及範圍自動儲存','Autosaved by customer and scope'):ecText('填寫客戶名稱後可儲存','Enter a customer name to save');
  drawEstimateEditor();renderEstimate();
}
function loadEstimateScope(preferred){
  const choices=estimateScope.value==='model'?models.map(m=>m.id):estimateScope.value==='family'?[...new Set([...Object.keys(estimateRates),...models.map(familyName)])]:['Total'];
  estimateTarget.replaceChildren(...choices.map(name=>new Option(name,name)));
  if(choices.includes(preferred))estimateTarget.value=preferred;
  $('#estimate-target-wrap').hidden=estimateScope.value==='all';loadEstimateTarget();
}
function drawEstimateEditor(){
  estimateLabels();const editor=$('#estimate-editor');editor.replaceChildren();
  estimatePlan.forEach((row,i)=>{
    const line=document.createElement('div');
    function field(label,value,onChange){
      const wrap=document.createElement('label'),input=document.createElement('input');
      wrap.textContent=label;input.type='number';input.step='any';input.setAttribute('form','estimate-only');input.value=String(value);
      input.oninput=()=>{onChange(input.valueAsNumber);editEstimate()};wrap.append(input);line.append(wrap);
    }
    if(i<estimatePlan.length-1)field(ecText('第 '+(i+1)+' 檔上限（USD）','Tier '+(i+1)+' ceiling (USD)'),row.end,v=>row.end=v);
    else line.append(ecText('最後一檔 · 無上限','Final tier · No ceiling'));
    field(ecText('實付比例（%）','Pay rate (%)'),Number((row.factor*100).toFixed(8)),v=>row.factor=v/100);
    if(i<estimatePlan.length-1){const del=document.createElement('button');del.type='button';del.textContent=ecText('移除','Remove');del.onclick=()=>{estimatePlan.splice(i,1);drawEstimateEditor();editEstimate()};line.append(del)}
    editor.append(line);
  });
}
$('#estimate-add').onclick=()=>{
  const last=estimatePlan.at(-1),prior=estimatePlan.at(-2)?.end||0;
  estimatePlan.splice(-1,0,{end:prior+50000,factor:last.factor});drawEstimateEditor();editEstimate();
};
const viewKey=()=> 'siraya:calculator:view:'+JSON.stringify([owner,estimateCustomer()]);
function rememberEstimateView(){
  if(estimateCustomer())try{localStorage.setItem(viewKey(),JSON.stringify([estimateScope.value,estimateTarget.value]))}catch{}
}
function restoreEstimateView(){
  const view=readEstimate(viewKey());
  estimateScope.value=['model','family','all'].includes(view?.[0])?view[0]:'family';
  loadEstimateScope(view?.[1]);
}
estimateScope.onchange=()=>{loadEstimateScope();rememberEstimateView()};
estimateTarget.onchange=()=>{loadEstimateTarget();rememberEstimateView()};
function renderEstimate(){
  const spend=amount.valueAsNumber,en=document.documentElement.lang==='en';
  const linear=mode.value==='linear',goal=limit.valueAsNumber,avg=average.valueAsNumber;
  $('#estimate-linear').hidden=!linear;$('#estimate-editor').hidden=linear;$('#estimate-add').hidden=linear;
  const ordered=linear?validCurve():validRows(estimatePlan);
  const marginal=v=>1-2*(1-avg)*Math.min(v/goal,1);
  const payment=v=>{if(!linear)return estimatePayment(v,estimatePlan);const part=Math.min(v,goal);return part*(1+marginal(part))/2+(v-part)*marginal(goal)};

  const valid=ordered&&Number.isFinite(spend)&&spend>=0&&spend<=1e9;
  const max=Math.min(1e9,Math.max(1000,ordered?(linear?goal:(estimatePlan.at(-2)?.end??100000))*2:200000,valid?Math.ceil(spend):0));
  if(valid){slider.max=String(max);slider.value=amount.value}
  const ends=linear?[goal,Infinity]:estimatePlan.map(t=>t.end),tier=ends.findIndex(end=>spend<=end);
  const rate=v=>en?Number((v*100).toFixed(2))+'%':Number((v*10).toFixed(3))+' 折';
  const money=new Intl.NumberFormat('en-US',{style:'currency',currency:'USD'});
  $('#estimate-note').textContent=!ordered?(en?'Enter increasing positive ceilings below $1 billion and rates from 0 to 100%.':'門檻須遞增且介於 0 和 10 億之間，實付比例須為 0～100%。'):valid?(en?'Current tier '+(tier+1):'目前位於第 '+(tier+1)+' 檔'):(en?'Enter a valid spend amount.':'請輸入有效的消費金額。');
  if(linear)$('#estimate-note').textContent=ordered?ecText('新增用量從原價線性降至 ','Marginal rate drops linearly from list price to ')+rate(marginal(goal))+ecText('，超過目標後沿用此比例。',' and stays there above target.'):ecText('目標金額須大於零且最多十億，綜合比例須在 0.5 至 1 之間。','Enter a positive target up to $1 billion and a blended rate between 0.5 and 1.');
  const pay=payment(spend);
  const metrics=[[ecText('新增用量實付比例','Marginal pay rate'),valid?rate(linear?marginal(spend):estimatePlan[tier].factor):'—'],[ecText('累計綜合折扣','Blended rate'),valid&&spend?rate(pay/spend):'—'],[ecText('累計實付','Estimated payment'),valid?money.format(pay):'—']];
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
  ctx.lineWidth=3;ctx.strokeStyle='#357bc0';ctx.beginPath();ctx.moveTo(x(0),y(linear?1:rates[0]));
  if(linear){ctx.lineTo(x(goal),y(marginal(goal)));ctx.lineTo(x(max),y(marginal(goal)))}else schedule.forEach(({end,factor},i)=>{ctx.lineTo(x(Math.min(end,max)),y(factor));if(i<schedule.length-1)ctx.lineTo(x(end),y(rates[i+1]))});
  ctx.stroke();
  const blend=v=>v?payment(v)/v:(linear?1:rates[0]);
  ctx.strokeStyle='#116d63';ctx.beginPath();ctx.moveTo(x(0),y(rates[0]));
  for(const [i,end] of [...ends.slice(0,-1),max].entries()){
    const start=i?ends[i-1]:0;
    for(let j=1;j<=50;j++){const v=start+(end-start)*j/50;ctx.lineTo(x(v),y(blend(v)))}
  }
  ctx.stroke();
  for(const [f,color] of [[linear?marginal(spend):rates[tier],'#357bc0'],[blend(spend),'#116d63']]){
    ctx.fillStyle=color;ctx.beginPath();ctx.arc(x(spend),y(f),4,0,Math.PI*2);ctx.fill();
  }
}
mode.onchange=editEstimate;limit.oninput=editEstimate;average.oninput=editEstimate;
$('#customer').addEventListener('input',restoreEstimateView);
$('#customer').addEventListener('estimate-customer',restoreEstimateView);
amount.oninput=renderEstimate;
slider.onpointerdown=()=>estimateDragging=true;
window.addEventListener('pointerup',()=>estimateDragging=false);
slider.onpointercancel=()=>estimateDragging=false;
slider.oninput=()=>{
  const raw=Number(slider.value),tol=Number(slider.max)*.017;
  const nearest=(mode.value==="linear"?[{end:limit.valueAsNumber}]:estimatePlan.slice(0,-1)).reduce((best,t)=>Math.abs(raw-t.end)<Math.abs(raw-best)?t.end:best,Infinity);
  amount.value=String(estimateDragging&&Math.abs(raw-nearest)<=tol?nearest:raw);
  renderEstimate();
};
new MutationObserver(()=>{drawEstimateEditor();renderEstimate()}).observe(document.documentElement,{attributes:true,attributeFilter:['lang']});
restoreEstimateView();
`;
