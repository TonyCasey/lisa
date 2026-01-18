// Pre-create ALL Graphiti indices synchronously to avoid race condition
// Each statement runs one at a time via cypher-shell

// ===== NODE INDICES =====

// Entity node indices
CREATE INDEX entity_uuid IF NOT EXISTS FOR (e:Entity) ON (e.uuid);
CREATE INDEX entity_group_id IF NOT EXISTS FOR (e:Entity) ON (e.group_id);
CREATE INDEX entity_name IF NOT EXISTS FOR (e:Entity) ON (e.name);
CREATE INDEX created_at_entity_index IF NOT EXISTS FOR (e:Entity) ON (e.created_at);

// Episodic node indices
CREATE INDEX episode_uuid IF NOT EXISTS FOR (e:Episodic) ON (e.uuid);
CREATE INDEX episode_group_id IF NOT EXISTS FOR (e:Episodic) ON (e.group_id);
CREATE INDEX created_at_episodic_index IF NOT EXISTS FOR (e:Episodic) ON (e.created_at);
CREATE INDEX valid_at_episodic_index IF NOT EXISTS FOR (e:Episodic) ON (e.valid_at);

// Community node indices
CREATE INDEX community_uuid IF NOT EXISTS FOR (e:Community) ON (e.uuid);
CREATE INDEX community_group_id IF NOT EXISTS FOR (e:Community) ON (e.group_id);
CREATE INDEX created_at_community_index IF NOT EXISTS FOR (e:Community) ON (e.created_at);

// ===== RELATIONSHIP INDICES =====

// RELATES_TO relationship indices (edges/facts)
CREATE INDEX relates_to_uuid IF NOT EXISTS FOR ()-[e:RELATES_TO]-() ON (e.uuid);
CREATE INDEX relates_to_group_id IF NOT EXISTS FOR ()-[e:RELATES_TO]-() ON (e.group_id);
CREATE INDEX name_edge_index IF NOT EXISTS FOR ()-[e:RELATES_TO]-() ON (e.name);
CREATE INDEX fact_uuid IF NOT EXISTS FOR ()-[e:RELATES_TO]-() ON (e.fact);
CREATE INDEX created_at_edge_index IF NOT EXISTS FOR ()-[e:RELATES_TO]-() ON (e.created_at);
CREATE INDEX valid_at_edge_index IF NOT EXISTS FOR ()-[e:RELATES_TO]-() ON (e.valid_at);
CREATE INDEX invalid_at_edge_index IF NOT EXISTS FOR ()-[e:RELATES_TO]-() ON (e.invalid_at);
CREATE INDEX expired_at_edge_index IF NOT EXISTS FOR ()-[e:RELATES_TO]-() ON (e.expired_at);

// MENTIONS relationship indices
CREATE INDEX mention_uuid IF NOT EXISTS FOR ()-[e:MENTIONS]-() ON (e.uuid);
CREATE INDEX mention_group_id IF NOT EXISTS FOR ()-[e:MENTIONS]-() ON (e.group_id);

// HAS_MEMBER relationship indices
CREATE INDEX has_member_uuid IF NOT EXISTS FOR ()-[e:HAS_MEMBER]-() ON (e.uuid);

// IN_COMMUNITY relationship indices
CREATE INDEX in_community_uuid IF NOT EXISTS FOR ()-[e:IN_COMMUNITY]-() ON (e.uuid);

// EPISODE_ENTITY relationship indices (for episode-entity links)
CREATE INDEX episode_entity_uuid IF NOT EXISTS FOR ()-[e:MENTIONED_IN]-() ON (e.uuid);
CREATE INDEX episode_entity_group_id IF NOT EXISTS FOR ()-[e:MENTIONED_IN]-() ON (e.group_id);

// ===== FULLTEXT INDICES =====

// Fulltext index for entity name and summary search
CREATE FULLTEXT INDEX node_name_and_summary IF NOT EXISTS FOR (e:Entity) ON EACH [e.name, e.summary, e.group_id];

// Fulltext index for community name search
CREATE FULLTEXT INDEX community_name IF NOT EXISTS FOR (e:Community) ON EACH [e.name, e.group_id];

// Fulltext index for episode content search
CREATE FULLTEXT INDEX episode_content IF NOT EXISTS FOR (e:Episodic) ON EACH [e.content, e.source, e.source_description, e.group_id];

// Fulltext index for edge name and fact search
CREATE FULLTEXT INDEX edge_name_and_fact IF NOT EXISTS FOR ()-[r:RELATES_TO]-() ON EACH [r.name, r.fact, r.group_id];

// ===== UNIQUENESS CONSTRAINTS =====
CREATE CONSTRAINT entity_uuid_unique IF NOT EXISTS FOR (e:Entity) REQUIRE e.uuid IS UNIQUE;
CREATE CONSTRAINT episode_uuid_unique IF NOT EXISTS FOR (e:Episodic) REQUIRE e.uuid IS UNIQUE;
CREATE CONSTRAINT community_uuid_unique IF NOT EXISTS FOR (e:Community) REQUIRE e.uuid IS UNIQUE;
