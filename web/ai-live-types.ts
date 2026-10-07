/** Contrato del modo IA en vivo (demo): colecciones de conocimiento, documentos y simulaciones generadas. */

export type KnowledgeCollection = { id: string; name: string; documentCount: number; chunkCount: number; createdAt: string };
export type KnowledgeDocument = { id: string; name: string; mime: string; bytes: number; chars: number; status: 'ready' | 'error' | 'processing'; error?: string | null; createdAt: string };

export type AiSource = { id: string; document: string; excerpt: string };
export type AiOption = { label: string; quality?: 'best' | 'acceptable' | 'poor' | string; consequence?: string; rationale?: string; sources?: string[] };
export type AiSituation = { id: string; index: number; title: string; narration: string; options: AiOption[]; sources: AiSource[] };
export type AiSummary = { spoken: string; takeaways: string[]; optimalCount: number; total: number };
export type AiRun = { id: string; collectionId: string; situationsTotal: number; index: number; status: string; focus?: string | null };
/** Fila de GET /api/ai-runs: situaciones ya generadas y respondidas. */
export type AiRunListItem = AiRun & { createdAt: string; generated: number; answered: number };

export type NextResponse = { situation: AiSituation; done?: false } | { done: true; summary: AiSummary };
export type AnswerResponse =
  | { kind: 'decision'; optionIndex: number; reaction: { spoken: string; quality?: string; sources?: AiSource[] } }
  | { kind: 'confirm'; optionIndex: number; prompt: string }
  | { kind: 'answer'; spoken: string; sources?: AiSource[] }
  | { kind: 'repeat' }
  | { kind: 'next' }
  | { kind: 'unclear'; spoken?: string };

export type RunResponse = { run: AiRun; current?: AiSituation | null; history?: unknown[]; summary?: AiSummary | null };

/** Bandera `ai_live_demo` de GET /api/me. La fija main.tsx al pintar la consola; solo docentes la ven activa. */
export const aiLiveFlag = { enabled: false };

export const MAX_UPLOAD_BYTES = 20 * 1024 * 1024;
export const ACCEPTED_EXTENSIONS = ['.pdf', '.docx', '.txt', '.md'];

export function mimeFor(file: File): string {
  if (file.type) return file.type;
  const name = file.name.toLowerCase();
  if (name.endsWith('.pdf')) return 'application/pdf';
  if (name.endsWith('.docx')) return 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
  if (name.endsWith('.md')) return 'text/markdown';
  return 'text/plain';
}
