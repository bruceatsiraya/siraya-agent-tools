import { inferCapabilities, type SirayaRegistry } from '@siraya/agent';

/** Confirmed model identity corrections also apply to cached and enriched registries. */
export function correctModelIdentities(registry: SirayaRegistry): SirayaRegistry {
  return {...registry, models:registry.models.map(model=>{
    if(!['siraya-seedance-2.5-flash','gemini-nano-banana-2.1','gemini-omni-1.1-flash-preview'].includes(model.id.toLowerCase())) return model;
    const video=inferCapabilities({...model.raw,id:model.id});
    return {...model,provider:video.provider,providerName:video.providerName,
      family:video.family,category:video.category,modalities:video.modalities,
      inputModalities:video.inputModalities,outputModalities:video.outputModalities,
      capabilityTags:video.capabilityTags,taskTags:video.taskTags,
      features:video.features,supportedParameters:video.supportedParameters};
  })};
}
