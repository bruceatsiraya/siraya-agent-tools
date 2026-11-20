import { identifyModel } from './model-identity.js';
import type { SirayaModel, SirayaModelCapability, SirayaModelCategory } from './types.js';

const vendorNames:Record<string,string>={openai:'openai',anthropic:'anthropic',google:'google','google deepmind':'google',deepseek:'deepseek',xai:'xai','x.ai':'xai',alibaba:'alibaba','alibaba cloud':'alibaba',qwen:'alibaba',moonshot:'moonshot','moonshot ai':'moonshot',zhipu:'zhipu','z.ai':'zhipu',minimax:'minimax',byteplus:'byteplus',bytedance:'byteplus','bytedance seed':'byteplus',kling:'kuaishou',kuaishou:'kuaishou'};
function declaredCategory(value:unknown):SirayaModelCategory|undefined {
  if(typeof value!=='string')return undefined;
  const name=value.toLowerCase();
  if(['llm','chat','text'].includes(name))return 'text';
  return ['image','video','audio','embedding','rerank'].includes(name)?name as SirayaModelCategory:undefined;
}
/** Executed for every model received from /v1/models, including unseen IDs. */
export function reviewScannedIdentity(model:SirayaModel):{
  provider:string;category:SirayaModelCategory;family:SirayaModelCapability['family'];check:NonNullable<SirayaModelCapability['identityCheck']>
} {
  const known=identifyModel(model.id);
  const explicitVendor=model.vendor ?? model.provider;
  // owned_by=openai is a generic router placeholder, not evidence about an unfamiliar ID.
  const declaredVendor=typeof explicitVendor==='string'?vendorNames[explicitVendor.toLowerCase()]:typeof model.owned_by==='string'&&model.owned_by.toLowerCase()!=='openai'?vendorNames[model.owned_by.toLowerCase()]:undefined;
  let provider=known&&known.provider!=='unknown'?known.provider:declaredVendor ?? 'unknown';
  const reasons:string[]=[];
  if(explicitVendor&&!declaredVendor){provider='unknown';reasons.push('The declared upstream vendor is not recognized.');}
  else if(known&&known.provider!=='unknown'&&declaredVendor&&known.provider!==declaredVendor){provider='unknown';reasons.push('Vendor metadata conflicts with the recognized model family.');}
  else if(provider==='unknown')reasons.push('Upstream vendor is not confirmed.');
  const declared=declaredCategory(model.category ?? model.type);
  const outputs=model.output_modalities ?? model.outputModalities;
  let output:SirayaModelCategory|undefined;
  if(Array.isArray(outputs)){
    const values=outputs.filter((v):v is string=>typeof v==='string').map(v=>v.toLowerCase());
    const media=['video','image','audio','embedding','ranking'].filter(v=>values.includes(v));
    if(media.length===1||media.includes('video'))output=media.includes('video')?'video':media[0]==='ranking'?'rerank':media[0] as SirayaModelCategory;
    else if(!media.length&&values.length&&values.every(v=>v==='text'))output='text';
  }
  let category=known?.category ?? declared ?? output ?? 'unknown';
  const evidence=declared ?? output;
  if(category==='unknown'&&evidence)category=evidence;
  if(model.category!==undefined&&!declared||Array.isArray(outputs)&&outputs.some(v=>typeof v!=='string'||!['text','image','video','audio','embedding','ranking'].includes(v.toLowerCase()))){category='unknown';reasons.push('The declared category or output modality is not recognized.');}
  if(declared&&output&&declared!==output||known&&known.category!=='unknown'&&evidence&&known.category!==evidence){category='unknown';reasons.push('Category metadata conflicts with the model family or output modalities.');}
  if(category==='unknown'&&!reasons.some(r=>r.startsWith('Category')))reasons.push('Model category is not confirmed; no LLM default is used.');
  const vendor=provider==='unknown'?'pending':'confirmed';const categoryStatus=category==='unknown'?'pending':'confirmed';
  const family=category==='unknown'?'other':category!=='text'?category:known?.family??'other';
  return {provider,category,family,check:{status:vendor==='pending'||categoryStatus==='pending'?'pending':'resolved',vendor,category:categoryStatus,source:declared||output||!known&&declaredVendor?'upstream_metadata':'family_rules',...(reasons.length?{reason:reasons.join(' ')}:{})}};
}
