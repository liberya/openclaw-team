-- =============================================================================
-- OpenClaw Database Schema - Memories & Vector Search
-- Note: pgvector extension requires superuser. Run as superuser to enable vector search.
-- =============================================================================

-- Enable pgvector extension (requires superuser)
-- CREATE EXTENSION IF NOT EXISTS vector;

-- Memories Table
CREATE TABLE IF NOT EXISTS memories (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    agent_id UUID REFERENCES agents(id) ON DELETE SET NULL,
    session_id UUID REFERENCES sessions(id) ON DELETE SET NULL,
    
    content TEXT NOT NULL,
    content_hash VARCHAR(64),
    
    embedding JSONB,
    
    metadata JSONB DEFAULT '{}',
    memory_type VARCHAR(50),
    
    tags TEXT[],
    
    is_deleted BOOLEAN DEFAULT false,
    
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    deleted_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_memories_user_id ON memories(user_id);
CREATE INDEX IF NOT EXISTS idx_memories_agent_id ON memories(agent_id);
CREATE INDEX IF NOT EXISTS idx_memories_session_id ON memories(session_id);
CREATE INDEX IF NOT EXISTS idx_memories_content_hash ON memories(content_hash);
CREATE INDEX IF NOT EXISTS idx_memories_is_deleted ON memories(is_deleted) WHERE is_deleted = false;
CREATE INDEX IF NOT EXISTS idx_memories_user_time ON memories(user_id, created_at DESC);

-- HNSW vector index for similarity search (requires pgvector)
-- Uncomment if pgvector extension is installed:
-- CREATE INDEX IF NOT EXISTS idx_memories_embedding ON memories 
--     USING hnsw (embedding vector_cosine_ops)
--     WITH (m = 16, ef_construction = 64);

DROP TRIGGER IF EXISTS memories_updated_at ON memories;
CREATE TRIGGER memories_updated_at
    BEFORE UPDATE ON memories
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at();

-- QMD Collections Table
CREATE TABLE IF NOT EXISTS qmd_collections (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    agent_id UUID REFERENCES agents(id) ON DELETE SET NULL,
    
    name VARCHAR(255) NOT NULL,
    description TEXT,
    
    config JSONB DEFAULT '{}',
    
    is_active BOOLEAN DEFAULT true,
    
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_qmd_collections_user_id ON qmd_collections(user_id);
CREATE INDEX IF NOT EXISTS idx_qmd_collections_agent_id ON qmd_collections(agent_id);

DROP TRIGGER IF EXISTS qmd_collections_updated_at ON qmd_collections;
CREATE TRIGGER qmd_collections_updated_at
    BEFORE UPDATE ON qmd_collections
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at();

-- QMD Chunks Table
CREATE TABLE IF NOT EXISTS qmd_chunks (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    
    collection_id UUID NOT NULL REFERENCES qmd_collections(id) ON DELETE CASCADE,
    
    content TEXT NOT NULL,
    content_hash VARCHAR(64),
    
    embedding JSONB,
    
    metadata JSONB DEFAULT '{}',
    chunk_index INTEGER,
    source_file VARCHAR(500),
    
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_qmd_chunks_collection_id ON qmd_chunks(collection_id);
CREATE INDEX IF NOT EXISTS idx_qmd_chunks_content_hash ON qmd_chunks(content_hash);
-- HNSW vector index (requires pgvector):
-- CREATE INDEX IF NOT EXISTS idx_qmd_chunks_embedding ON qmd_chunks 
--     USING hnsw (embedding vector_cosine_ops)
--     WITH (m = 16, ef_construction = 64);