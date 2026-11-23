export interface PriceUnit {
  billingUnit: string;
  salePrice: string;
  unitScale: string;
  unit: string;
}
export interface PriceScenario {
  currency: string;
  name: string;
  conditions: {attribute:string;operator:string;value:string}[];
  units: PriceUnit[];
}
export interface CatalogPrice {
  checkedAt: string;
  scenarios: PriceScenario[];
}
export function conditionLabel(s: PriceScenario) {
  const ops:Record<string,string>={lte:'≤',gte:'≥',lt:'<',gt:'>',eq:'='};
  return s.conditions.map(c=>[c.attribute,ops[c.operator]??c.operator,c.value].join(' ')).join(' · ');
}

function billingBasis(u:PriceUnit) {
  const scale=Number(u.unitScale);
  const unit=u.unit.toLowerCase();
  if (/^tokens?$/.test(unit) && scale===1000000) return '每百萬 token';
  if (scale===1) {
    if (/^(s|seconds?)$/.test(unit)) return '每秒';
    if (/^images?$/.test(unit)) return '每張圖';
    if (/^requests?$/.test(unit)) return '每次請求';
  }
  return '/ '+scale.toLocaleString('en-US')+' '+u.unit;
}

export function priceDetails(price: CatalogPrice | undefined, escape:(v:unknown)=>string) {
  if(!price?.scenarios.length)return '—';
  return price.scenarios.map(s=>{
    const groups = new Map<string,PriceUnit[]>();
    for(const u of s.units){
      const basis=billingBasis(u);
      if(!groups.has(basis))groups.set(basis,[]);
      groups.get(basis)!.push(u);
    }
    const title=[s.name==='default'?'':s.name,conditionLabel(s)].filter(Boolean).join(' · ');
    return '<div class="catalog-price" title="'+escape(price.checkedAt)+'" style="text-align:left;padding:4px 0">'+
      (title?'<strong>'+escape(title)+'</strong>':'')+
      Array.from(groups,([basis,units])=>'<div style="color:#116d63;font-weight:650">'+escape(basis)+'</div>'+
        units.map(u=>'<div style="display:flex;justify-content:space-between;gap:1rem"><span>'+escape(u.billingUnit)+'</span><b style="font-variant-numeric:tabular-nums">'+escape(s.currency)+' '+escape(u.salePrice.replace(/(\.\d*?[1-9])0+$|\.0+$/,'$1'))+'</b></div>').join('')
      ).join('')+'</div>';
  }).join('');
}
const key = 'siraya:official-prices:v1';

export async function syncOfficialPrices(kv: KVNamespace, fetchPage = fetch) {
  const models = new Map<string, CatalogPrice>();
  const checkedAt = new Date().toISOString();
  let received = 0;
  for (let page = 1; page <= 20; page++) {
    const response = await fetchPage(`https://llm-ext-api.siraya.ai/api/v1/models?page=${page}&pageSize=50`, {signal:AbortSignal.timeout(5000)});
    if (!response.ok) throw Error('Siraya price API unavailable');
    const {data} = await response.json() as {data:{items:{code:string;pricing:PriceScenario[]}[];total:number}};
    if (!data.items.length || !Number.isInteger(data.total)) throw Error('Incomplete Siraya price catalog');
    received += data.items.length;
    for (const model of data.items) {
      const scenarios = model.pricing.filter(s => s.units.length && s.units.every(u =>
        /^\d+(\.\d+)?$/.test(u.salePrice) && Number.isFinite(Number(u.salePrice)) &&
        Number(u.unitScale) > 0 && Number.isFinite(Number(u.unitScale))));
      const code = model.code.toLowerCase();
      if (models.has(code)) throw Error('Duplicate Siraya model code');
      models.set(code,{checkedAt,scenarios});
    }
    if (received === data.total) {
      const snapshot = Object.fromEntries(models);
      await kv.put(key,JSON.stringify(snapshot));
      return snapshot;
    }
  }
  throw Error('Incomplete Siraya price catalog');
}

export async function officialPrices(kv: KVNamespace) {
  try {
    return await kv.get<Record<string,CatalogPrice>>(key,'json') ?? await syncOfficialPrices(kv);
  } catch {
    return {};
  }
}

export function priceSummary(price?: CatalogPrice) {
  return price?.scenarios.length ? price.scenarios.map(s =>
    [s.name,...s.conditions.map(c=>`${c.attribute} ${c.operator} ${c.value}`),
      ...s.units.map(u=>`${u.billingUnit}: ${s.currency} ${u.salePrice} / ${u.unitScale} ${u.unit}`)].join('\n')
  ).join('\n\n') + '\n\n' + price.checkedAt : null;
}
