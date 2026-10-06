/**
 * Contrato AIProvider (arquitectura v1.1, §13, §14 y §30).
 * Solo interfaz: la implementación llega en la macrofase de IA avanzada.
 * Reglas: toda llamada pasa por el backend y AI Gateway; Unity nunca tiene claves.
 */
export type AIProviderId = 'workers-ai' | 'openai' | 'azure-openai' | 'anthropic' | 'gemini' | 'local';

export interface AIMessage { role: 'system' | 'user' | 'assistant'; content: string }

export interface AIRequest {
  tenantId: string;
  sessionId?: string;
  /** Propósito auditable de la llamada, p. ej. 'character_reply' o 'debrief_summary'. */
  purpose: string;
  messages: AIMessage[];
  model?: string;
  maxTokens?: number;
  temperature?: number;
  stream?: boolean;
}

export interface AIUsage { inputTokens: number; outputTokens: number; costEur?: number }

export interface AIResponse {
  provider: AIProviderId;
  model: string;
  modelVersion?: string;
  text: string;
  usage: AIUsage;
  latencyMs: number;
  /** ID de traza en AI Gateway para auditoría. */
  traceId?: string;
  fallbackUsed: boolean;
}

export interface AIProvider {
  readonly id: AIProviderId;
  complete(request: AIRequest): Promise<AIResponse>;
  stream?(request: AIRequest): AsyncIterable<string>;
}

/** Selección de proveedor con fallback y límites de coste por tenant. */
export interface AIRouter {
  complete(request: AIRequest): Promise<AIResponse>;
}
