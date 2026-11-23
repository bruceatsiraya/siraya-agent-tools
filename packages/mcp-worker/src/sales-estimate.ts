export const estimatePanel = `<section id="estimate"><h2>價格試算</h2>
<label>每月原價消費（USD）<input id="estimate-amount" form="estimate-only" type="number" min="0" max="1000000000" step=".01" value="75000"></label>
<input id="estimate-slider" type="range" min="0" max="200000" step=".01" value="75000" aria-label="Monthly list-price spend (USD)">
<p id="estimate-note"></p><div style="overflow:auto"><table><thead id="estimate-head"></thead><tbody id="estimate-results"></tbody></table></div>
<select id="estimate-model" aria-label="Chart model"><option>Claude</option><option>GPT</option><option>Gemini</option></select>
<p id="estimate-legend"></p><canvas id="estimate-chart" width="760" height="220" role="img"></canvas></section>`;

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
const amount=$('#estimate-amount'),slider=$('#estimate-slider'),chartModel=$('#estimate-model');
const estimateRates={Claude:[.9,.74,.82],GPT:[.8,.64,.72],Gemini:[.85,.71,.78]};
function renderEstimate(){
  const spend=amount.valueAsNumber,en=document.documentElement.lang==='en';
  const valid=Number.isFinite(spend)&&spend>=0&&spend<=1e9;
  const max=Math.max(200000,valid?Math.ceil(spend):0);
  if(valid){slider.max=String(max);slider.value=amount.value}
  const ends=[50000,100000,Infinity],tier=ends.findIndex(end=>spend<=end);
  const tiers=rates=>rates.map((factor,i)=>({factor,end:ends[i]}));
  const rate=v=>en?Number((v*100).toFixed(2))+'%':Number((v*10).toFixed(3))+' 折';
  const money=new Intl.NumberFormat('en-US',{style:'currency',currency:'USD'});
  const titles=en?['Model','Current tier rate','Blended rate','Estimated payment']:['模型','當前檔折扣','累計綜合折扣','累計實付'];
  $('#estimate-head').innerHTML='<tr>'+titles.map(v=>'<th>'+v+'</th>').join('')+'</tr>';
  $('#estimate-note').textContent=valid?(en?'Each model is estimated separately. Tiers change above $50,000 and $100,000.':'各模型按所選用量獨立試算，超過 $50,000 和 $100,000 的部分進入下一檔。'):(en?'Enter a valid spend amount.':'請輸入有效的消費金額。');
  $('#estimate-results').innerHTML=Object.entries(estimateRates).map(([model,rates])=>{
    const pay=estimatePayment(spend,tiers(rates));
    const cells=[model,valid?rate(rates[tier]):'—',valid&&spend?rate(pay/spend):'—',valid?money.format(pay):'—'];
    return '<tr>'+cells.map(v=>'<td>'+v+'</td>').join('')+'</tr>';
  }).join('');
  const legend=en?'Blue · Current tier rate / Green · Blended rate':'藍線 · 當前檔折扣 ／ 綠線 · 累計綜合折扣';
  $('#estimate-legend').textContent=legend;
  const canvas=$('#estimate-chart'),ctx=canvas.getContext('2d');
  canvas.setAttribute('aria-label',chartModel.value+' · '+legend);
  ctx.clearRect(0,0,760,220);
  if(!valid)return;
  const rates=estimateRates[chartModel.value],schedule=tiers(rates);
  const x=v=>48+655*v/max,y=v=>180-(v-.6)*390;
  ctx.font='13px system-ui';ctx.fillStyle='#52647b';
  for(const f of [.6,.7,.8,.9,1])ctx.fillText(rate(f),0,y(f)+4);
  for(const v of [0,50000,100000,max])ctx.fillText('$'+v.toLocaleString('en-US'),x(v)-12,208);
  ctx.lineWidth=3;ctx.strokeStyle='#357bc0';ctx.beginPath();ctx.moveTo(x(0),y(rates[0]));
  schedule.forEach(({end,factor},i)=>{ctx.lineTo(x(Math.min(end,max)),y(factor));if(i<2)ctx.lineTo(x(end),y(rates[i+1]))});
  ctx.stroke();
  const blend=v=>v?estimatePayment(v,schedule)/v:rates[0];
  ctx.strokeStyle='#116d63';ctx.beginPath();ctx.moveTo(x(0),y(rates[0]));
  for(const [i,end] of [50000,100000,max].entries()){
    const start=i?ends[i-1]:0;
    for(let j=1;j<=50;j++){const v=start+(end-start)*j/50;ctx.lineTo(x(v),y(blend(v)))}
  }
  ctx.stroke();
  for(const [f,color] of [[rates[tier],'#357bc0'],[blend(spend),'#116d63']]){
    ctx.fillStyle=color;ctx.beginPath();ctx.arc(x(spend),y(f),4,0,Math.PI*2);ctx.fill();
  }
}
amount.oninput=renderEstimate;slider.oninput=()=>{amount.value=slider.value;renderEstimate()};
chartModel.onchange=renderEstimate;
new MutationObserver(renderEstimate).observe(document.documentElement,{attributes:true,attributeFilter:['lang']});
renderEstimate();
`;
