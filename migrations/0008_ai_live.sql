-- Modo IA en vivo (demo, flag ai_live_demo): colecciones de conocimiento del instructor, sus documentos y fragmentos,
-- y las partidas generadas con IA sobre una colección. Todo lleva tenant_id y toda consulta filtra por él.
-- Los originales están en R2 (knowledge/<tenant>/<colección>/<documento>) y los vectores de cada documento en
-- R2 (mismo prefijo + «.vec», Float32 normalizados en el orden de `ord`): la recuperación lee un binario por
-- documento en lugar de miles de BLOB de D1 (que D1 devuelve como arrays de números y cuestan CPU).
CREATE TABLE IF NOT EXISTS knowledge_collections (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL,
  name TEXT NOT NULL,
  created_by TEXT NOT NULL,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS knowledge_collections_by_tenant ON knowledge_collections(tenant_id, created_at DESC);

CREATE TABLE IF NOT EXISTS knowledge_documents (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL,
  collection_id TEXT NOT NULL,
  name TEXT NOT NULL,
  mime TEXT NOT NULL,
  bytes INTEGER NOT NULL,
  chars INTEGER NOT NULL DEFAULT 0,
  -- processing: en curso (o interrumpido); ready: con fragmentos y vectores; error: ver `error` (mensaje para el usuario).
  status TEXT NOT NULL CHECK (status IN ('processing', 'ready', 'error')),
  error TEXT,
  chunk_count INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS knowledge_documents_by_collection ON knowledge_documents(tenant_id, collection_id, created_at);

CREATE TABLE IF NOT EXISTS knowledge_chunks (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL,
  collection_id TEXT NOT NULL,
  document_id TEXT NOT NULL,
  ord INTEGER NOT NULL,
  -- Pista de cita: «p. 3» o el último encabezado Markdown anterior al fragmento.
  hint TEXT,
  text TEXT NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS knowledge_chunks_by_document ON knowledge_chunks(tenant_id, document_id, ord);
CREATE INDEX IF NOT EXISTS knowledge_chunks_by_collection ON knowledge_chunks(tenant_id, collection_id);

-- Partida de IA en vivo: estado general en state_json (foco, anclas de recuperación, confirmación pendiente).
CREATE TABLE IF NOT EXISTS ai_runs (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL,
  collection_id TEXT NOT NULL,
  created_by TEXT NOT NULL,
  created_at TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('active', 'complete')),
  situations_total INTEGER NOT NULL,
  current_index INTEGER NOT NULL DEFAULT 0,
  state_json TEXT NOT NULL,
  summary_json TEXT
);
CREATE INDEX IF NOT EXISTS ai_runs_by_tenant ON ai_runs(tenant_id, created_at DESC);
CREATE INDEX IF NOT EXISTS ai_runs_by_collection ON ai_runs(tenant_id, collection_id);

-- Una situación por fila. La clave (run_id, idx) hace que la generación anticipada y la petición del cliente no
-- generen dos veces la misma situación: la primera reclama la fila («generating») y la otra espera a «ready».
-- No se guarda la frase dicha por la persona, solo la opción elegida.
CREATE TABLE IF NOT EXISTS ai_turns (
  run_id TEXT NOT NULL,
  tenant_id TEXT NOT NULL,
  idx INTEGER NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('generating', 'ready', 'error')),
  claimed_at TEXT NOT NULL,
  situation_json TEXT,
  answered INTEGER NOT NULL DEFAULT 0,
  chosen INTEGER,
  reaction_json TEXT,
  PRIMARY KEY (run_id, idx)
);
CREATE INDEX IF NOT EXISTS ai_turns_by_tenant ON ai_turns(tenant_id, run_id);
