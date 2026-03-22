-- =============================================================================
-- OpenClaw Database Schema - Row Level Security (RLS) Policies
-- =============================================================================

-- Enable RLS on all user-data tables
ALTER TABLE agents ENABLE ROW LEVEL SECURITY;
ALTER TABLE sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE messages ENABLE ROW LEVEL SECURITY;
ALTER TABLE memories ENABLE ROW LEVEL SECURITY;
ALTER TABLE qmd_collections ENABLE ROW LEVEL SECURITY;
ALTER TABLE qmd_chunks ENABLE ROW LEVEL SECURITY;
ALTER TABLE user_secrets ENABLE ROW LEVEL SECURITY;

-- =============================================================================
-- Agents Policies
-- =============================================================================

-- Allow users to read their own agents
CREATE POLICY agents_read_policy ON agents
    FOR SELECT
    USING (
        user_id = current_setting('app.current_user_id', true)::uuid
        OR organization_id IN (
            SELECT organization_id 
            FROM organization_members 
            WHERE user_id = current_setting('app.current_user_id', true)::uuid
        )
    );

-- Allow users to insert their own agents
CREATE POLICY agents_insert_policy ON agents
    FOR INSERT
    WITH CHECK (user_id = current_setting('app.current_user_id', true)::uuid);

-- Allow users to update their own agents
CREATE POLICY agents_update_policy ON agents
    FOR UPDATE
    USING (user_id = current_setting('app.current_user_id', true)::uuid)
    WITH CHECK (user_id = current_setting('app.current_user_id', true)::uuid);

-- Allow users to delete (soft delete) their own agents
CREATE POLICY agents_delete_policy ON agents
    FOR DELETE
    USING (user_id = current_setting('app.current_user_id', true)::uuid);

-- =============================================================================
-- Sessions Policies
-- =============================================================================

CREATE POLICY sessions_read_policy ON sessions
    FOR SELECT
    USING (user_id = current_setting('app.current_user_id', true)::uuid);

CREATE POLICY sessions_insert_policy ON sessions
    FOR INSERT
    WITH CHECK (user_id = current_setting('app.current_user_id', true)::uuid);

CREATE POLICY sessions_update_policy ON sessions
    FOR UPDATE
    USING (user_id = current_setting('app.current_user_id', true)::uuid)
    WITH CHECK (user_id = current_setting('app.current_user_id', true)::uuid);

CREATE POLICY sessions_delete_policy ON sessions
    FOR DELETE
    USING (user_id = current_setting('app.current_user_id', true)::uuid);

-- =============================================================================
-- Messages Policies
-- =============================================================================

CREATE POLICY messages_read_policy ON messages
    FOR SELECT
    USING (
        session_id IN (
            SELECT id 
            FROM sessions 
            WHERE user_id = current_setting('app.current_user_id', true)::uuid
        )
    );

CREATE POLICY messages_insert_policy ON messages
    FOR INSERT
    WITH CHECK (
        session_id IN (
            SELECT id 
            FROM sessions 
            WHERE user_id = current_setting('app.current_user_id', true)::uuid
        )
    );

CREATE POLICY messages_delete_policy ON messages
    FOR DELETE
    USING (
        session_id IN (
            SELECT id 
            FROM sessions 
            WHERE user_id = current_setting('app.current_user_id', true)::uuid
        )
    );

-- =============================================================================
-- Memories Policies
-- =============================================================================

CREATE POLICY memories_read_policy ON memories
    FOR SELECT
    USING (user_id = current_setting('app.current_user_id', true)::uuid);

CREATE POLICY memories_insert_policy ON memories
    FOR INSERT
    WITH CHECK (user_id = current_setting('app.current_user_id', true)::uuid);

CREATE POLICY memories_update_policy ON memories
    FOR UPDATE
    USING (user_id = current_setting('app.current_user_id', true)::uuid)
    WITH CHECK (user_id = current_setting('app.current_user_id', true)::uuid);

CREATE POLICY memories_delete_policy ON memories
    FOR DELETE
    USING (user_id = current_setting('app.current_user_id', true)::uuid);

-- =============================================================================
-- QMD Collections Policies
-- =============================================================================

CREATE POLICY qmd_collections_read_policy ON qmd_collections
    FOR SELECT
    USING (user_id = current_setting('app.current_user_id', true)::uuid);

CREATE POLICY qmd_collections_insert_policy ON qmd_collections
    FOR INSERT
    WITH CHECK (user_id = current_setting('app.current_user_id', true)::uuid);

CREATE POLICY qmd_collections_update_policy ON qmd_collections
    FOR UPDATE
    USING (user_id = current_setting('app.current_user_id', true)::uuid)
    WITH CHECK (user_id = current_setting('app.current_user_id', true)::uuid);

CREATE POLICY qmd_collections_delete_policy ON qmd_collections
    FOR DELETE
    USING (user_id = current_setting('app.current_user_id', true)::uuid);

-- =============================================================================
-- QMD Chunks Policies
-- =============================================================================

CREATE POLICY qmd_chunks_read_policy ON qmd_chunks
    FOR SELECT
    USING (
        collection_id IN (
            SELECT id 
            FROM qmd_collections 
            WHERE user_id = current_setting('app.current_user_id', true)::uuid
        )
    );

CREATE POLICY qmd_chunks_insert_policy ON qmd_chunks
    FOR INSERT
    WITH CHECK (
        collection_id IN (
            SELECT id 
            FROM qmd_collections 
            WHERE user_id = current_setting('app.current_user_id', true)::uuid
        )
    );

CREATE POLICY qmd_chunks_delete_policy ON qmd_chunks
    FOR DELETE
    USING (
        collection_id IN (
            SELECT id 
            FROM qmd_collections 
            WHERE user_id = current_setting('app.current_user_id', true)::uuid
        )
    );

-- =============================================================================
-- User Secrets Policies
-- =============================================================================

CREATE POLICY user_secrets_read_policy ON user_secrets
    FOR SELECT
    USING (user_id = current_setting('app.current_user_id', true)::uuid);

CREATE POLICY user_secrets_insert_policy ON user_secrets
    FOR INSERT
    WITH CHECK (user_id = current_setting('app.current_user_id', true)::uuid);

CREATE POLICY user_secrets_update_policy ON user_secrets
    FOR UPDATE
    USING (user_id = current_setting('app.current_user_id', true)::uuid)
    WITH CHECK (user_id = current_setting('app.current_user_id', true)::uuid);

CREATE POLICY user_secrets_delete_policy ON user_secrets
    FOR DELETE
    USING (user_id = current_setting('app.current_user_id', true)::uuid);

-- =============================================================================
-- Helper Function: Set current user context
-- =============================================================================

-- Function to set current user context for RLS
CREATE OR REPLACE FUNCTION set_current_user(p_user_id UUID)
RETURNS VOID AS $$
BEGIN
    PERFORM set_config('app.current_user_id', p_user_id::text, true);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Function to clear current user context
CREATE OR REPLACE FUNCTION clear_current_user()
RETURNS VOID AS $$
BEGIN
    PERFORM set_config('app.current_user_id', NULL, true);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;