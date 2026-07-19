// @mlv/ai — Gemini client wrapper, rate limiter, prompt templates per AI service
// Hanya dipakai oleh services/ai-gateway (satu-satunya pemegang API key, §17.1).
// Domain lain memanggil ai-gateway via HTTP, bukan import langsung.

export { GeminiClient } from './gemini-client';
export type { GeminiGenerateOptions, GeminiGenerateResult } from './gemini-client';

export { RateLimiter } from './rate-limiter';
export type { RateLimitResult } from './rate-limiter';

export {
  buildDesignAnalyzerSystemPrompt,
  buildDesignAnalyzerUserPrompt,
} from './prompt-templates/design-analyzer';
export type { DesignAnalyzerInput } from './prompt-templates/design-analyzer';

export {
  buildQuotationSystemPrompt,
  buildQuotationUserPrompt,
} from './prompt-templates/quotation-assistant';
export type { QuotationAssistantInput } from './prompt-templates/quotation-assistant';

export {
  buildCustomerSupportSystemPrompt,
  buildCustomerSupportUserPrompt,
} from './prompt-templates/customer-support';
export type { CustomerSupportInput } from './prompt-templates/customer-support';

export {
  buildProductionAssistantSystemPrompt,
  buildProductionAssistantUserPrompt,
} from './prompt-templates/production-assistant';
export type { ProductionAssistantInput } from './prompt-templates/production-assistant';

export {
  buildInventoryPredictionSystemPrompt,
  buildInventoryPredictionUserPrompt,
} from './prompt-templates/inventory-prediction';
export type { InventoryPredictionInput } from './prompt-templates/inventory-prediction';
