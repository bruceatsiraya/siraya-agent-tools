import { inferCapabilities, type SirayaRegistry } from '@siraya/agent';

/** Confirmed model identity corrections also apply to cached and enriched registries. */
export function correctModelIdentities(registry: SirayaRegistry): SirayaRegistry {
  const models=registry.models.map(model=>{
    const inferred=inferCapabilities({...model.raw,id:model.id});
    const manual=model.identityCheck?.source==='manual_review';
    const vendor=manual?model.identityCheck!.vendor:inferred.identityCheck!.vendor;
    const category=manual?model.identityCheck!.category:inferred.identityCheck!.category;
    const identityCheck:NonNullable<typeof model.identityCheck>={...inferred.identityCheck!,vendor,category,status:vendor==='confirmed'&&category==='confirmed'?'resolved':'pending',source:manual?'manual_review':inferred.identityCheck!.source,checkedAt:registry.generatedAt};
    if(identityCheck.status==='resolved')delete identityCheck.reason;
    const fields={provider:manual?(vendor==='confirmed'?model.provider:'unknown'):inferred.provider,providerName:manual?(vendor==='confirmed'?model.providerName:'Unverified'):inferred.providerName,family:manual?(category==='confirmed'?model.family:'other'):inferred.family,category:manual?(category==='confirmed'?model.category:'unknown' as const):inferred.category,identityCheck};
    if(!['siraya-seedance-2.5-flash','gemini-nano-banana-2.1','gemini-omni-1.1-flash-preview'].includes(model.id.toLowerCase()))return {...model,...fields};
    return {...model,...fields,modalities:inferred.modalities,inputModalities:inferred.inputModalities,outputModalities:inferred.outputModalities,capabilityTags:inferred.capabilityTags,taskTags:inferred.taskTags,features:inferred.features,supportedParameters:inferred.supportedParameters};
  });
  return {...registry,models,identitySummary:{checkedAt:registry.generatedAt,total:models.length,pending:models.filter(m=>m.identityCheck.status==='pending').length,pendingVendor:models.filter(m=>m.identityCheck.vendor==='pending').length,pendingCategory:models.filter(m=>m.identityCheck.category==='pending').length}};
}
