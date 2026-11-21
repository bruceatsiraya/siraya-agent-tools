export const estimatePanel = `<section id="estimate"><h2>價格試算</h2>
<div class="estimate-grid"><div>
<label>消費範圍<select id="estimate-scope"><option value="platform">全平台</option><option value="vendor">單供應商</option><option value="model">單模型</option></select></label>
<label id="estimate-target-label" hidden>適用對象<select id="estimate-target"></select></label>
<label>每月原價消費（USD）<input id="estimate-amount" form="estimate-only" type="number" min="0" max="1000000000" value="10000"></label>
<input id="estimate-slider" type="range" min="0" max="20000" step="1" value="10000" aria-label="每月原價消費（USD）">
<label>階梯設定（USD 上限 × 實付係數）<input id="estimate-tiers" form="estimate-only" placeholder="2000:1, 5000:0.9, *:0.8"></label>
<small>門檻按模型配價後金額累計。空白表示不加階梯優惠，最多四檔。</small>
</div><div>
<p><strong id="estimate-factor">—</strong> <span>綜合實付比例</span> · <strong id="estimate-pay">—</strong> <span>預估應付</span></p>
<canvas id="estimate-chart" width="760" height="270" role="img"></canvas>
<small id="estimate-mix"></small><p id="estimate-error" role="status"></p>
</div></div></section>`;

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
const amount=$('#estimate-amount'), slider=$('#estimate-slider'), escope=$('#estimate-scope'), target=$('#estimate-target');
function estimateTargets(){
  const options=escope.value==='vendor'?[...new Set(models.map(m=>m.vendor))]:models.map(m=>m.id);
  target.replaceChildren(...options.map(value=>{const o=new Option(value,value);o.dataset.noTranslate='';return o}));
  $('#estimate-target-label').hidden=escope.value==='platform';renderEstimate();
}
function renderEstimate(){
  const chart=$('#estimate-chart'), ctx=chart.getContext('2d');
  const en=document.documentElement.lang==='en', fmt=new Intl.NumberFormat(en?'en-US':'zh-TW',{style:'currency',currency:'USD'});
  ctx.clearRect(0,0,760,270);
  const scoped=models.filter(m=>escope.value==='platform'||(escope.value==='vendor'?m.vendor:m.id)===target.value);
  const selected=scoped.filter(m=>item(m.id).selected);
  const group=selected.length?selected:scoped;
  const factor=group.reduce((sum,m)=>sum+effectiveFactor(m,state),0)/group.length;
  $('#estimate-mix').textContent=group.length>1?'多模型按原價消費等額分配。':'';
  const raw=$('#estimate-tiers').value.trim()||'*:1';
  const tiers=raw.split(',').map((token,i,all)=>{
    const match=token.trim().match(/^(\\*|\\d+(?:\\.\\d+)?)\\s*:\\s*(\\d+(?:\\.\\d+)?)$/);
    return match&&{end:match[1]==='*'&&i===all.length-1?Infinity:Number(match[1]),factor:Number(match[2])};
  });
  const spend=amount.valueAsNumber, max=Number(slider.max);
  const invalid=tiers.length>4||tiers.at(-1)?.end!==Infinity||tiers.some((t,i)=>!t||!(t.end>(tiers[i-1]?.end??0))||t.factor>(tiers[i-1]?.factor??1));
  const error=invalid?'請輸入遞增門檻與遞減係數，最後一檔使用 *。':!group.length?'此範圍沒有模型。':!Number.isFinite(spend)||spend<0||spend>1e9?'請輸入有效的消費金額。':'';
  $('#estimate-error').textContent=error;
  const pay=error?NaN:estimatePayment(spend*factor,tiers);
  const percent=spend=>spend?estimatePayment(spend*factor,tiers)/spend:factor*tiers[0].factor;
  const percentage=v=>(v*100).toFixed(1)+'%';
  $('#estimate-pay').textContent=error?'—':fmt.format(pay);
  $('#estimate-factor').textContent=error||!spend?'—':percentage(percent(spend));
  chart.setAttribute('aria-label',error||($('#estimate-factor').textContent+' · '+fmt.format(spend)));
  if(error)return;
  const x=v=>62+v/max*665, y=v=>224-v*193;
  ctx.font='15px system-ui';ctx.fillStyle='#52647b';
  for(const mark of [0,.25,.5,.75,1]){
    ctx.fillText(mark*100+'%',4,y(mark)+5);
    ctx.strokeStyle='#dce5eb';ctx.beginPath();ctx.moveTo(62,y(mark));ctx.lineTo(727,y(mark));ctx.stroke();
  }
  ctx.fillText(fmt.format(0),62,254);ctx.textAlign='right';ctx.fillText(fmt.format(max),727,254);ctx.textAlign='left';
  ctx.strokeStyle='#116d63';ctx.lineWidth=3;ctx.beginPath();
  const samples=[...new Set([...Array.from({length:181},(_,i)=>i*max/180),...tiers.map(t=>t.end/factor).filter(v=>v>0&&v<max)])].sort((a,b)=>a-b);
  samples.forEach((v,i)=>i?ctx.lineTo(x(v),y(percent(v))):ctx.moveTo(x(v),y(percent(v))));ctx.stroke();
  ctx.fillStyle='#116d63';ctx.beginPath();ctx.arc(x(spend),y(percent(spend)),6,0,Math.PI*2);ctx.fill();
}
amount.oninput=()=>{if(amount.valueAsNumber>=0&&amount.valueAsNumber<=1e9){slider.max=String(Math.max(20000,Math.ceil(amount.valueAsNumber)));slider.value=amount.value}renderEstimate()};
slider.oninput=()=>{amount.value=slider.value;renderEstimate()};
escope.onchange=estimateTargets;target.onchange=renderEstimate;$('#estimate-tiers').oninput=renderEstimate;
new MutationObserver(renderEstimate).observe(document.documentElement,{attributes:true,attributeFilter:['lang']});
estimateTargets();
`;
