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
#reverse-rows .reverse-row{display:grid;grid-template-columns:minmax(0,1fr) minmax(0,1fr) auto auto;align-items:end;gap:8px;padding:10px 0;border-top:1px solid #dce4ef}#reverse-rows input{min-width:0}#reverse-rows input[readonly]{background:#edf2f6}
@media(max-width:800px){#estimate .ec-layout{grid-template-columns:1fr}}
#estimate .ec-figure{margin:16px 0 0;background:white;border:1px solid #d6e0ed;border-radius:10px;padding:12px;min-width:0}
#estimate-legend{display:flex;gap:8px 18px;align-items:center;flex-wrap:wrap;color:#42566c;font-size:13px}
#estimate-legend span{display:inline-flex;align-items:center;gap:6px}
#estimate-legend span:before{content:"";width:20px;border-top:3px solid #357bc0}
#estimate-legend span:nth-child(2):before{border-color:#116d63;border-top-style:dashed}
#estimate-legend strong{margin-inline-start:auto;font-variant-numeric:tabular-nums}
#estimate-results strong{font-variant-numeric:tabular-nums}
#estimate-results div:first-child strong{color:#357bc0}
</style><div class="ec-scope"><label><span data-ec="scope"></span><select id="estimate-scope"><option value="family">模型系列</option><option value="model">單模型</option><option value="all">總體消費</option></select></label>
<label id="estimate-target-wrap"><span data-ec="target"></span><select id="estimate-target"></select></label></div><div class="ec-layout">
<details open class="ec-box"><summary data-ec="tiers"></summary><select hidden id="estimate-mode"><option value="tiers"></option><option value="reverse"></option><option value="linear"></option></select>
<div id="estimate-methods" style="display:flex;flex-wrap:wrap;gap:6px;margin:12px 0"><button type="button" value="tiers">按各檔折扣試算</button><button type="button" value="reverse">按目標實付率反推</button><button type="button" value="linear">無極階梯</button></div>
<div id="estimate-linear" hidden><label><span data-ec="threshold"></span><input type="number" id="estimate-limit" form="estimate-only" step="any"></label><label><span data-ec="average"></span><input type="number" id="estimate-average" form="estimate-only" step="any" min=".5" max="1"></label></div>
<div id="estimate-reverse" hidden><label><span data-ec="targetrate"></span><input id="reverse-rate" form="estimate-only" type="number" step="any" min="0" max="100"></label><p id="reverse-rule"></p><div id="reverse-rows"></div><button type="button" id="reverse-add" data-ec="add"></button><label><span data-ec="tail"></span><input id="reverse-tail" type="number" step="any" form="estimate-only" placeholder="Auto"></label></div>
<small id="estimate-save" role="status"></small><div id="estimate-editor"></div><button type="button" id="estimate-add" data-ec="add"></button></details>
<div class="ec-box"><label>每月原價消費（USD）<input id="estimate-amount" form="estimate-only" type="number" min="0" max="1000000000" step=".01" value="75000"></label>
<input id="estimate-slider" type="range" min="0" max="200000" step=".01" value="75000" aria-label="Monthly list-price spend (USD)">
<div id="estimate-marks" style="display:flex;flex-wrap:wrap;gap:.5rem"></div><p id="estimate-note"></p><div id="estimate-results"></div>

<div id="estimate-checkpoints" style="overflow:auto;margin-top:12px"></div><figure class="ec-figure"><figcaption id="estimate-legend"></figcaption><canvas id="estimate-chart" width="760" height="220" role="img"></canvas></figure></div></div></section>`;

export function estimatePayment(base: number, tiers: {end:number;factor:number}[]) {
  let start=0, payment=0;
  for(const {end,factor} of tiers){
    payment+=Math.max(0,Math.min(base,end)-start)*factor;
    start=end;
  }
  return payment;
}

export const estimateScript = `
const estimatePayment = ${estimatePayment.toString()};
function solveTarget(rows, target) {
  const goal=rows.at(-1)?.end ?? 0;
  if(!goal || !Number.isFinite(target) || target<0 || target>1 ||
    rows.some((r,i)=>!Number.isFinite(r.end)||r.end<=(rows[i-1]?.end??0)||r.end>=1e9||
      (r.locked&&(!Number.isFinite(r.factor)||r.factor<0||r.factor>1))))return null;
  function schedule(step){
    let anchor=1, distance=0;
    return rows.map(row=>{
      if(row.locked){anchor=row.factor;distance=0}
      else distance++;
      return {end:row.end,factor:row.locked?row.factor:Math.max(0,anchor-distance*step)};
    });
  }
  const blended=step=>estimatePayment(goal,schedule(step))/goal;
  const min=blended(1),max=blended(0);
  if(target<min-1e-12||target>max+1e-12)return {min,max,tiers:null};
  let lo=0,hi=1;
  for(let i=0;i<55;i++){const mid=(lo+hi)/2;if(blended(mid)>target)lo=mid;else hi=mid}
  return {min,max,tiers:schedule((lo+hi)/2)};
}

const amount=$('#estimate-amount'),slider=$('#estimate-slider');
const estimateRates={Claude:[.9,.74,.82],GPT:[.8,.64,.72],Gemini:[.85,.71,.78]};
const estimateScope=$('#estimate-scope'),estimateTarget=$('#estimate-target');
const familyName=m=>Object.keys(estimateRates).find(name=>name.toLowerCase()===String(m.family).toLowerCase())||m.family||'Other';
const mode=$('#estimate-mode'),limit=$('#estimate-limit'),average=$('#estimate-average');
const estimateCustomer=()=>$('#customer').value.trim();
const recordKey=()=> 'siraya:calculator:v1:'+JSON.stringify([owner,estimateCustomer(),estimateScope.value,estimateTarget.value]);
function readEstimate(key){try{return JSON.parse(localStorage.getItem(key)||'null')}catch{return null}}
const validRows=rows=>Array.isArray(rows)&&rows.length>0&&rows.every((t,i)=>t&&Number.isFinite(t.factor)&&t.factor>=0&&t.factor<=1&&(i===rows.length-1?t.end===Infinity:Number.isFinite(t.end)&&t.end<1e9&&t.end>(rows[i-1]?.end??0)));
let reverseRows=[],reverseTarget=77,reverseTail=null;
function saveEstimate(){
  if(!estimateCustomer())return;
  try{
    const record=readEstimate(recordKey())||{};
    if(mode.value==='tiers'&&validRows(estimatePlan))record.rows=estimatePlan;
    else if(mode.value==='linear'&&validCurve()){record.limit=limit.valueAsNumber;record.average=average.valueAsNumber}
    else if(mode.value==='reverse'&&Number.isFinite(reverseTarget)&&reverseTarget>=0&&reverseTarget<=100&&reverseRows.every((r,i)=>Number.isFinite(r.end)&&r.end>(reverseRows[i-1]?.end??0)&&r.end<1e9&&Number.isFinite(r.factor)&&r.factor>=0&&r.factor<=1)&&(reverseTail===null||Number.isFinite(reverseTail)&&reverseTail>=0&&reverseTail<=100)){record.reverse={rows:reverseRows,target:reverseTarget,tail:reverseTail}}
    else {$('#estimate-save').textContent=ecText('請修正輸入後儲存','Correct inputs to save');return}
    record.mode=mode.value;localStorage.setItem(recordKey(),JSON.stringify(record));
    $('#estimate-save').textContent=ecText('已儲存至此瀏覽器','Saved in this browser');
  }catch{$('#estimate-save').textContent=ecText('瀏覽器無法儲存設定','Browser storage unavailable')}
}
function validCurve(){return limit.valueAsNumber>0&&limit.valueAsNumber<=1e9&&average.valueAsNumber>=.5&&average.valueAsNumber<=1}
function editEstimate(){saveEstimate();renderEstimate()}

const ecText=(zh,en)=>document.documentElement.lang==='en'?en:zh;
function estimateLabels(){
  const labels={targetrate:['目標綜合實付率（%）','Target blended pay rate (%)'],tail:['超額部分實付率（%，留空維持目標）','Overage rate (%, blank to maintain target)'],mode:['計價方式','Pricing mode'],threshold:['目標原價用量（USD）','Target spend (USD)'],average:['目標綜合實付比例（0.5–1）','Target blended pay rate (0.5–1)'],scope:['消費範圍','Usage scope'],target:estimateScope.value==='model'?['模型','Model']:['模型系列','Model family'],tiers:['分段計價設定','Pricing tiers'],add:['新增檔位','Add tier']};
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
  reverseRows=Array.isArray(saved?.reverse?.rows)&&saved.reverse.rows.length?saved.reverse.rows.map(r=>({...r})):[{end:50000,factor:.9,locked:true},{end:100000,factor:.74,locked:false},{end:150000,factor:.6,locked:false}];
  reverseTarget=saved?.reverse?.target??77;reverseTail=saved?.reverse?.tail??null;
  mode.value=['reverse','linear'].includes(saved?.mode)?saved.mode:'tiers';limit.value=saved?.limit??100000;average.value=saved?.average??.8;
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
function drawReverseEditor(){
  const host=$('#reverse-rows');host.replaceChildren();
  $('#reverse-rate').value=reverseTarget;$('#reverse-tail').value=reverseTail??'';
  reverseRows.forEach((row,i)=>{
    const line=document.createElement('div');line.className='reverse-row';
    function input(labelText,value,edit){
      const label=document.createElement('label'),box=document.createElement('input');
      label.textContent=labelText;box.type='number';box.step='any';box.setAttribute('form','estimate-only');box.value=value;
      box.oninput=()=>{edit(box.valueAsNumber);editEstimate()};label.append(box);line.append(label);return box;
    }
    input(i===reverseRows.length-1?ecText('目標用量（USD）','Target spend (USD)'):ecText('檔位上限（USD）','Tier ceiling (USD)'),row.end,v=>row.end=v);
    const factor=input(ecText('該檔實付率（%）','Tier pay rate (%)'),row.factor*100,v=>row.factor=v/100);
    factor.readOnly=!row.locked;factor.dataset.result=i;
    const label=document.createElement('label'),lock=document.createElement('input');
    lock.type='checkbox';lock.checked=row.locked;label.append(lock,ecText('鎖定','Lock'));line.append(label);
    lock.onchange=()=>{if(lock.checked&&factor.value!=='')row.factor=Number(factor.value)/100;row.locked=lock.checked;factor.readOnly=!row.locked;editEstimate()};
    if(reverseRows.length>1){const remove=document.createElement('button');remove.type='button';remove.textContent=ecText('移除','Remove');remove.onclick=()=>{reverseRows.splice(i,1);drawReverseEditor();editEstimate()};line.append(remove)}
    host.append(line);
  });
}
$('#reverse-add').onclick=()=>{reverseRows.push({end:reverseRows.at(-1).end+50000,factor:1,locked:false});drawReverseEditor();editEstimate()};
$('#reverse-rate').oninput=e=>{reverseTarget=e.target.valueAsNumber;editEstimate()};
$('#reverse-tail').oninput=e=>{reverseTail=e.target.value===''?null:e.target.valueAsNumber;editEstimate()};
function drawEstimateEditor(){
  drawReverseEditor();estimateLabels();const editor=$('#estimate-editor');editor.replaceChildren();
  estimatePlan.forEach((row,i)=>{
    const line=document.createElement('div');
    if(i>0&&i===estimatePlan.length-1){
      const summary=document.createElement('p');summary.id='forward-summary';
      summary.style.gridColumn='1 / -1';line.append(summary);editor.append(line);return;
    }
    function field(label,value,onChange){
      const wrap=document.createElement('label'),input=document.createElement('input');
      wrap.textContent=label;input.type='number';input.step='any';input.setAttribute('form','estimate-only');input.value=String(value);
      input.oninput=()=>{onChange(input.valueAsNumber);editEstimate()};wrap.append(input);line.append(wrap);
    }
    if(i<estimatePlan.length-1)field(ecText('第 '+(i+1)+' 檔上限（USD）','Tier '+(i+1)+' ceiling (USD)'),row.end,v=>row.end=v);
    else line.append(ecText('最後一檔 · 無上限','Final tier · No ceiling'));
    field(i===estimatePlan.length-1?ecText('超額部分實付率（%）','Overage pay rate (%)'):ecText('該檔實付率（%）','Tier pay rate (%)'),Number((row.factor*100).toFixed(8)),v=>row.factor=v/100);
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
  const reverse=mode.value==='reverse';
  $('#estimate-reverse').hidden=!reverse;$('#estimate-editor').hidden=linear||reverse;$('#estimate-add').hidden=linear||reverse;
  const solution=reverse?solveTarget(reverseRows,reverseTarget/100):null;
  const plan=reverse?[...(solution?.tiers??[]),{end:Infinity,factor:(reverseTail??reverseTarget)/100}]:estimatePlan;
  const ordered=linear?validCurve():reverse?!!solution?.tiers&&validRows(plan):validRows(plan);
  if(!linear&&!reverse&&plan.length>1){
    const ceiling=plan.at(-2).end,summary=$('#forward-summary');
    if(ordered){
      const finalRate=estimatePayment(ceiling,plan)/ceiling;
      plan.at(-1).factor=finalRate;
      const percent=new Intl.NumberFormat(en?'en-US':'zh-TW',{style:'percent',maximumFractionDigits:4}).format(finalRate);
      const threshold='$'+ceiling.toLocaleString('en-US');
      summary.textContent=ecText('滿 '+threshold+' 的綜合實付率：'+percent+'。超額部分自動按 '+percent+' 計費。','Blended rate at '+threshold+': '+percent+'. Automatic overage rate: '+percent+'.');
    }else summary.textContent=ecText('請修正檔位以計算超額費率。','Correct the tiers to calculate the overage rate.');
  }
  if(reverse){
    $('#reverse-rule').textContent=ecText('未鎖定檔位從前一個鎖定費率（起始為原價）等幅遞減，最低為零。','Unlocked tiers decrease by equal steps from the preceding lock or list price, down to zero.');
    for(const box of document.querySelectorAll('#reverse-rows input[data-result]'))if(box.readOnly)box.value=solution?.tiers?Number((solution.tiers[Number(box.dataset.result)].factor*100).toFixed(6)):'';
  }
  const marginal=v=>1-2*(1-avg)*Math.min(v/goal,1);
  const payment=v=>{if(!linear)return estimatePayment(v,plan);const part=Math.min(v,goal);return part*(1+marginal(part))/2+(v-part)*marginal(goal)};

  const valid=ordered&&Number.isFinite(spend)&&spend>=0&&spend<=1e9;
  const max=Math.min(1e9,Math.max(1000,ordered?(linear?goal:(plan.at(-2)?.end??100000))*2:200000,valid?Math.ceil(spend):0));
  if(valid){slider.max=String(max);slider.value=amount.value}
  const ends=linear?[goal,Infinity]:plan.map(t=>t.end),tier=ends.findIndex(end=>spend<=end);
  const rate=v=>en?Number((v*100).toFixed(2))+'%':Number((v*10).toFixed(3))+' 折';
  const money=new Intl.NumberFormat('en-US',{style:'currency',currency:'USD'});
  $('#estimate-note').textContent=!ordered?(en?'Enter increasing positive ceilings below $1 billion and rates from 0 to 100%.':'門檻須遞增且介於 0 和 10 億之間，實付比例須為 0～100%。'):valid?(en?'Current tier '+(tier+1):'目前位於第 '+(tier+1)+' 檔'):(en?'Enter a valid spend amount.':'請輸入有效的消費金額。');
  if(linear)$('#estimate-note').textContent=ordered?ecText('新增用量從原價線性降至 ','Marginal rate drops linearly from list price to ')+rate(marginal(goal))+ecText('，超過目標後沿用此比例。',' and stays there above target.'):ecText('目標金額須大於零且最多十億，綜合比例須在 0.5 至 1 之間。','Enter a positive target up to $1 billion and a blended rate between 0.5 and 1.');
  if(reverse&&!ordered&&solution&&!solution.tiers)$('#estimate-note').textContent=ecText('此組鎖定條件可達範圍：','Achievable range with these locks: ')+rate(solution.min)+' – '+rate(solution.max);
  const pay=payment(spend);
  const checkpoints=$('#estimate-checkpoints');checkpoints.replaceChildren();
  if(!linear&&ordered){
    const table=document.createElement('table');
    const heading=table.createTHead().insertRow();
    for(const title of [ecText('用量門檻','Spend ceiling'),ecText('該檔實付率','Tier rate'),ecText('累計實付','Payment'),ecText('綜合實付率','Blended rate')]){
      const th=document.createElement('th');th.textContent=title;heading.append(th);
    }
    const body=table.createTBody();let prior=0,total=0;
    for(const row of plan){
      if(row.end===Infinity)break;
      total+=(row.end-prior)*row.factor;prior=row.end;
      const tr=body.insertRow();
      for(const v of [money.format(row.end),rate(row.factor),money.format(total),rate(total/row.end)])tr.insertCell().textContent=v;
    }
    checkpoints.append(table);
  }
  const metrics=[[ecText('新增用量實付比例','Marginal pay rate'),valid?rate(linear?marginal(spend):plan[tier].factor):'—'],[ecText('累計綜合折扣','Blended rate'),valid&&spend?rate(pay/spend):'—'],[ecText('累計實付','Estimated payment'),valid?money.format(pay):'—']];
  $('#estimate-results').replaceChildren(...metrics.map(([name,value])=>{
    const card=document.createElement('div'),valueEl=document.createElement('strong');
    valueEl.textContent=value;card.append(name,valueEl);return card;
  }));
  const legend=metrics.slice(0,2).map(([name])=>name).join(' / ');
  const caption=$('#estimate-legend');
  caption.replaceChildren(...metrics.slice(0,2).map(([name])=>{
    const label=document.createElement('span');label.textContent=name;return label;
  }));
  const selection=document.createElement('strong');
  selection.textContent=valid?ecText('目前用量 ','Selected spend ')+money.format(spend):'—';
  caption.append(selection);
  mode.options[0].textContent=ecText('按各檔折扣試算','Set tier rates');
  mode.options[1].textContent=ecText('按目標實付率反推','Solve for target rate');
  mode.options[2].textContent=ecText('無極階梯','Continuous');
  for(const [i,b] of Array.from($('#estimate-methods').children).entries()){
    b.textContent=mode.options[i].textContent;b.setAttribute('aria-pressed',String(b.value===mode.value));b.classList.toggle('primary',b.value===mode.value);
  }
  const canvas=$('#estimate-chart'),ctx=canvas.getContext('2d');
  canvas.setAttribute('aria-label',estimateTarget.value+' · '+legend);
  const width=Math.max(240,Math.round(canvas.getBoundingClientRect().width)),height=228;
  const density=window.devicePixelRatio||1;
  canvas.style.height=height+'px';
  canvas.width=Math.round(width*density);canvas.height=Math.round(height*density);
  ctx.setTransform(density,0,0,density,0,0);
  const marks=$('#estimate-marks');marks.replaceChildren();
  slider.style.background='';
  if(ordered){
    const stops=ends.slice(0,-1).map(v=>100*v/max);
    slider.style.appearance='none';slider.style.height='10px';slider.style.borderRadius='6px';
    slider.style.background='linear-gradient(to right,'+[0,...stops].map((start,i)=>(i%2?'#82c6b9':'#a6c8eb')+' '+start+'% '+(stops[i]??100)+'%').join(',')+')';
    ends.slice(0,-1).forEach((v,i)=>{const b=document.createElement('button');b.type='button';b.textContent=(linear?ecText('目標','Target'):(en?'Tier '+(i+1):'第 '+(i+1)+' 檔')+' ≤')+' $'+v.toLocaleString();b.onclick=()=>{amount.value=String(v);renderEstimate()};marks.append(b)});
  }
  if(!valid)return;
  const rates=plan.map(t=>t.factor),schedule=plan;
  const x=v=>48+(width-66)*v/max,y=v=>190-v*166;
  ctx.font='12px system-ui';ctx.fillStyle='#52647b';ctx.textAlign='right';
  for(const f of [0,.25,.5,.75,1]){
    ctx.fillText(rate(f),40,y(f)+4);ctx.strokeStyle='#dce4ed';
    ctx.beginPath();ctx.moveTo(x(0),y(f));ctx.lineTo(x(max),y(f));ctx.stroke();
  }
  const axis=v=>'$'+v.toLocaleString('en-US');
  ctx.textAlign='left';ctx.fillText(axis(0),x(0),215);
  ctx.textAlign='right';ctx.fillText(axis(max),x(max),215);
  const rightEdge=x(max)-ctx.measureText(axis(max)).width-8;
  let labelEdge=x(0)+ctx.measureText(axis(0)).width+8;
  ctx.textAlign='center';ctx.setLineDash([4,4]);
  for(const end of ends.slice(0,-1)){
    const pos=x(end),half=ctx.measureText(axis(end)).width/2;
    if(pos-half<labelEdge||pos+half>rightEdge)continue;
    ctx.fillText(axis(end),pos,215);labelEdge=pos+half+8;
    ctx.beginPath();ctx.moveTo(pos,y(1));ctx.lineTo(pos,y(0));ctx.stroke();
  }
  ctx.strokeStyle='#9baec0';ctx.beginPath();ctx.moveTo(x(spend),y(1));ctx.lineTo(x(spend),y(0));ctx.stroke();ctx.setLineDash([]);
  ctx.lineWidth=3;ctx.strokeStyle='#357bc0';ctx.beginPath();ctx.moveTo(x(0),y(linear?1:rates[0]));
  if(linear){ctx.lineTo(x(goal),y(marginal(goal)));ctx.lineTo(x(max),y(marginal(goal)))}else schedule.forEach(({end,factor},i)=>{ctx.lineTo(x(Math.min(end,max)),y(factor));if(i<schedule.length-1)ctx.lineTo(x(end),y(rates[i+1]))});
  ctx.stroke();
  const blend=v=>v?payment(v)/v:(linear?1:rates[0]);
  ctx.strokeStyle='#116d63';ctx.setLineDash([7,4]);ctx.beginPath();ctx.moveTo(x(0),y(blend(0)));
  for(const [i,end] of [...ends.slice(0,-1),max].entries()){
    const start=i?ends[i-1]:0;
    for(let j=1;j<=50;j++){const v=start+(end-start)*j/50;ctx.lineTo(x(v),y(blend(v)))}
  }
  ctx.stroke();
  for(const [f,color] of [[linear?marginal(spend):rates[tier],'#357bc0'],[blend(spend),'#116d63']]){
    ctx.setLineDash([]);ctx.fillStyle=color;ctx.beginPath();ctx.arc(x(spend),y(f),color==='#357bc0'?6:3,0,Math.PI*2);ctx.fill();ctx.lineWidth=1.5;ctx.strokeStyle='white';ctx.stroke();
  }
}
mode.onchange=editEstimate;limit.oninput=editEstimate;average.oninput=editEstimate;
$('#estimate-methods').onclick=e=>{if(e.target.tagName==='BUTTON'){mode.value=e.target.value;editEstimate()}};
$('#customer').addEventListener('input',restoreEstimateView);
$('#customer').addEventListener('estimate-customer',restoreEstimateView);
amount.oninput=renderEstimate;
slider.onpointerdown=()=>estimateDragging=true;
window.addEventListener('pointerup',()=>estimateDragging=false);
slider.onpointercancel=()=>estimateDragging=false;
slider.oninput=()=>{
  const raw=Number(slider.value),tol=Number(slider.max)*.017;
  const nearest=(mode.value==="linear"?[{end:limit.valueAsNumber}]:mode.value==='reverse'?reverseRows:estimatePlan.slice(0,-1)).reduce((best,t)=>Math.abs(raw-t.end)<Math.abs(raw-best)?t.end:best,Infinity);
  amount.value=String(estimateDragging&&Math.abs(raw-nearest)<=tol?nearest:raw);
  renderEstimate();
};
new MutationObserver(()=>{drawEstimateEditor();renderEstimate()}).observe(document.documentElement,{attributes:true,attributeFilter:['lang']});
restoreEstimateView();
if(typeof ResizeObserver!=='undefined')new ResizeObserver(renderEstimate).observe($('#estimate-chart'));
`;
