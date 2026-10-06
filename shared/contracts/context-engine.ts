/**
 * Contrato del AXYRO Context Engine (arquitectura v1.1, §7–§12 y §29).
 * Solo interfaz: Realtime RAG pertenece a la macrofase 3 y no debe bloquear el MVP.
 * Live = Durable Objects · Knowledge = R2 + AI Search/Vectorize · User = D1 · Scenario = D1 + R2.
 */
export type MemoryKind = 'live' | 'knowledge' | 'user' | 'scenario';

export interface ContextQuery {
  tenantId: string;
  sessionId: string;
  /** Usuario seudónimo; la identidad real no entra en el contexto. */
  userId?: string;
  trigger: 'question' | 'action' | 'voice' | 'event';
  text?: string;
  maxItems?: number;
}

export interface ContextItem {
  memory: MemoryKind;
  content: string;
  /** Referencia trazable: evento, documento o regla de origen. */
  sourceRef: string;
  score?: number;
}

export interface ContextBundle {
  query: ContextQuery;
  items: ContextItem[];
  assembledAt: string;
}

export interface MemorySource {
  readonly kind: MemoryKind;
  retrieve(query: ContextQuery): Promise<ContextItem[]>;
}

export interface ContextEngine {
  /** Router → recuperación en las cuatro memorias → reranking → ensamblado. */
  assemble(query: ContextQuery): Promise<ContextBundle>;
}
