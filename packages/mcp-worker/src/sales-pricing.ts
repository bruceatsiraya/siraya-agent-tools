export interface PricingModel { id: string; vendor: string; name: string; category: string; base: number }
export interface PricingDraft {
  customer: string; days: number; note: string;
  vendors: Record<string, number>;
  models: Record<string, { selected: boolean; override: number | null }>;
}
export function validFactor(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 && value <= 1;
}
export function effectiveFactor(model: PricingModel, draft: PricingDraft): number {
  return draft.models[model.id]?.override ?? draft.vendors[model.vendor] ?? model.base;
}
export function applyVendor(draft: PricingDraft, models: PricingModel[], vendor: string, factor: number, overwrite = false, select = true): PricingDraft {
  if (!validFactor(factor) || !models.some(m => m.vendor === vendor)) throw new Error('Invalid vendor discount');
  const next = structuredClone(draft); next.vendors[vendor] = factor;
  for (const model of models.filter(m => m.vendor === vendor)) {
    const current = next.models[model.id] ?? {selected:false,override:null};
    next.models[model.id] = { selected: select || current.selected, override: overwrite ? null : current.override };
  }
  return next;
}
export function restoreDraft(value: unknown, models: PricingModel[]): PricingDraft {
  const raw = value as Partial<PricingDraft> | null;
  if (!raw || typeof raw !== 'object' || typeof raw.customer !== 'string' || raw.customer.length > 120 || typeof raw.note !== 'string' || raw.note.length > 2000 || !Number.isInteger(raw.days) || raw.days! < 1 || raw.days! > 365 || !raw.vendors || typeof raw.vendors !== 'object' || !raw.models || typeof raw.models !== 'object') throw new Error('Invalid draft');
  const draft: PricingDraft = {customer:raw.customer,days:raw.days!,note:raw.note,vendors:{},models:{}};
  for(const vendor of new Set(models.map(m=>m.vendor))) if(Object.hasOwn(raw.vendors,vendor)) {
    const value = raw.vendors[vendor]; if(!validFactor(value)) throw new Error('Invalid factor');
    Object.defineProperty(draft.vendors,vendor,{value,writable:true,enumerable:true,configurable:true});
  }
  for(const model of models) if(Object.hasOwn(raw.models,model.id)) {
    const item=raw.models[model.id]; if(!item || typeof item.selected !== 'boolean' || item.override!==null&&!validFactor(item.override)) throw new Error('Invalid factor');
    // Retain the effective price when an audited upstream vendor replaces a legacy brand label.
    const id=model.id.toLowerCase();
    const legacyVendor=/^happyhorse/.test(id)?'HappyHorse':/^wan\d/.test(id)?'Wan':/^qwen/.test(id)?'Qwen':/^glm/.test(id)?'GLM':/^kimi/.test(id)?'Kimi':null;
    let override=item.override;
    if(override===null && legacyVendor && legacyVendor!==model.vendor && Object.hasOwn(raw.vendors,legacyVendor)) {
      const previous=raw.vendors[legacyVendor];if(!validFactor(previous))throw new Error('Invalid factor');override=previous;
    }
    Object.defineProperty(draft.models,model.id,{value:{selected:item.selected,override},writable:true,enumerable:true,configurable:true});
  }
  return draft;
}
