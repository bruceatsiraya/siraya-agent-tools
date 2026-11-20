import type { SirayaModelCapability, SirayaModelCategory } from './types.js';

export interface ModelIdentity {
  provider: string;
  category: SirayaModelCategory;
  family: SirayaModelCapability['family'];
  source: string;
  operation?: 'face_detection' | 'text_to_speech';
}

function recognizedTextModel(id:string):boolean {
  return [
    /^claude-(?:fable|haiku|opus|sonnet)-\d+(?:\.\d+)*(?:-\d{4}-\d{2}-\d{2})?$/,
    /^deepseek-(?:v\d+(?:\.\d+)*|r\d+)(?:-(?:flash|pro|economy|chat|reasoner|latest|exp|\d{4}-\d{2}-\d{2}|\d{4}))*$/,
    /^gpt-\d+(?:\.\d+)*(?:-(?:mini|nano|pro|codex|max|luna|sol|terra|astra|\d{4}-\d{2}-\d{2}))*$/,
    /^o[134](?:-(?:mini|pro|preview|\d{4}-\d{2}-\d{2}))*$/,
    /^gemini-\d+(?:\.\d+)*-(?:flash|pro)(?:-(?:lite|preview|latest|\d{4}-\d{2}-\d{2}))*$/,
    /^qwen\d+(?:\.\d+)*(?:-(?:flash|plus|max|\d+b|latest|preview|\d{4}-\d{2}-\d{2}))*$/,
    /^kimi-k\d+(?:\.\d+)*(?:-(?:code|highspeed|thinking|instruct|preview|pro))*$/,
    /^glm-\d+(?:\.\d+)*(?:-(?:flash|air|plus|instruct|preview))*$/,
    /^grok-\d+(?:[.-]\d+)*(?:-(?:fast|reasoning|non|beta|latest))*$/,
    /^minimax-m\d+(?:\.\d+)*(?:-(?:lightning|highspeed|instruct|preview))*$/,
    /^(?:bytedance-)?seed-(?:sc|\d+(?:\.\d+)*)(?:-(?:code|lite|mini|pro|turbo))*$/
  ].some(pattern=>pattern.test(id));
}

/** Upstream identity wins over routing aliases and the generic owned_by=openai placeholder. */
export function identifyModel(modelId: string): ModelIdentity | undefined {
  const id=modelId.toLowerCase().replace(/^(?:(?:nsfw|uncensored|siraya|dola|fw)[-_/])+/g,'');
  const entry=(provider:string,category:SirayaModelCategory,family:ModelIdentity['family'],source:string,operation?:ModelIdentity['operation']):ModelIdentity=>{
    const unfamiliarKling=provider==='kuaishou'&&!/^kling-(?:tts|avatar|face-recognition|lip-sync|(?:o\d+|\d+(?:\.\d+)*)(?:-(?:pro|standard|turbo|omni|flash|master))*)$/.test(id);
    const unfamiliarHappyHorse=/^happyhorse/.test(id)&&!/^happyhorse-\d+(?:\.\d+)*-(?:i2v|r2v|t2v|video-edit)$/.test(id);
    const unfamiliarWan=/^wan\d/.test(id)&&!/^wan\d+(?:\.\d+)*-(?:i2v|r2v|t2v|videoedit|video)(?:-(?:prime|pro|spicy))*$/.test(id);
    return unfamiliarKling||unfamiliarHappyHorse||unfamiliarWan?{provider,category:'unknown',family:'other',source}:{provider,category,family,source,operation};
  };
  if(/^kling(?:[-_]|$)/.test(id)) return entry('kuaishou',id==='kling-tts'?'audio':'video',id==='kling-tts'?'audio':'video','https://docs.siraya.ai/docs/api-reference/generative-model-api/text-to-video/kling/',id==='kling-face-recognition'?'face_detection':id==='kling-tts'?'text_to_speech':undefined);
  if(/^happyhorse[-_]/.test(id)) return entry('alibaba','video','video','https://www.alibabacloud.com/help/en/model-studio/happyhorse-1-0-i2v');
  if(/^wan\d/.test(id)) return entry('alibaba','video','video','https://docs.siraya.ai/docs/api-reference/generative-model-api/text-to-video/wan/');
  if(/^(?:minimax-h\d|hailuo[-_\d])/.test(id)) return entry('minimax','video','video','https://docs.siraya.ai/docs/api-reference/generative-model-api/text-to-video/minimax-h3/');
  if(/^(?:bytedance-)?seedance(?:[-_\d]|$)/.test(id)) return entry('byteplus','video','video','https://docs.siraya.ai/docs/api-reference/generative-model-api/Seedance/');
  if(/^(?:bytedance-)?seedream(?:[-_\d]|$)/.test(id)) return entry('byteplus','image','image','https://docs.siraya.ai/docs/api-reference/generative-model-api/Seedream/');
  if(/^(?:bytedance-)?seed(?:[-_\d]|$)/.test(id)) return entry('byteplus',recognizedTextModel(id)?'text':'unknown',recognizedTextModel(id)?'seed':'other','https://docs.siraya.ai/docs/text-generation/families/seed/');
  if(/^(?:face|head)-swap(?:[-_]|$)/.test(id)) return entry('unknown','image','image','https://docs.siraya.ai/docs/api-reference/generative-model-api/image-to-image/face-head-swap/');
  if(/^z-image(?:[-_]|$)/.test(id)) return entry('alibaba','image','image','https://github.com/Tongyi-MAI/Z-Image');
  if(/^gemini[-_]/.test(id)) {
    const category=id.includes('embedding')?'embedding':id.includes('-omni-')?'video':/nano-banana|image/.test(id)?'image':'text';
    if(category==='text'&&!recognizedTextModel(id))return entry('google','unknown','other','https://ai.google.dev/gemini-api/docs/models');
    return entry('google',category,category==='text'?'gemini':category,'https://ai.google.dev/gemini-api/docs/models');
  }
  if(/^veo(?:[-_\d]|$)/.test(id)) return entry('google','video','video','https://ai.google.dev/gemini-api/docs/video');
  if(/^imagen(?:[-_\d]|$)/.test(id)) return entry('google','image','image','https://ai.google.dev/gemini-api/docs/imagen');
  if(/^gpt-image(?:[-_\d]|$)/.test(id)) return entry('openai','image','image','https://platform.openai.com/docs/guides/image-generation');
  if(/^qwen/.test(id)) {
    const category=/image/.test(id)?'image':/asr|audio|tts/.test(id)?'audio':/embed/.test(id)?'embedding':/rerank/.test(id)?'rerank':'text';
    if(category==='text'&&!recognizedTextModel(id))return entry('alibaba','unknown','other','https://www.alibabacloud.com/help/en/model-studio/models');
    return entry('alibaba',category,category==='text'?'qwen':category,'https://www.alibabacloud.com/help/en/model-studio/models',/tts/.test(id)?'text_to_speech':undefined);
  }
  const textFamilies:Array<[RegExp,string,ModelIdentity['family'],string]>=[
    [/^claude[-_]/,'anthropic','claude','claude'],[/^deepseek[-_]/,'deepseek','deepseek','deepseek'],
    [/^grok[-_]/,'xai','grok','grok'],[/^kimi[-_]/,'moonshot','kimi','kimi'],
    [/^glm[-_]/,'zhipu','glm','glm'],[/^minimax[-_]/,'minimax','minimax','minimax'],
    [/^(?:gpt[-_]|o[134](?:[-_.]|$))/,'openai','gpt','gpt']
  ];
  for(const [pattern,provider,family,doc] of textFamilies) if(pattern.test(id)) return entry(provider,recognizedTextModel(id)?'text':'unknown',recognizedTextModel(id)?family:'other','https://docs.siraya.ai/docs/text-generation/families/'+doc+'/');
  return undefined;
}
