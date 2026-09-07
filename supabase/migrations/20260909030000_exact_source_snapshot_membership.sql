-- Freeze normalization membership from independently verified source chunks,
-- never from a mutable source timestamp or every version in the raw table.
BEGIN;
SET LOCAL lock_timeout='5s';
CREATE TABLE wf_canonical_staging.immutable_source_snapshots (
 manifest_sha256 text PRIMARY KEY CHECK(manifest_sha256 ~ '^[a-f0-9]{64}$'),
 manifest jsonb NOT NULL,
 sealed boolean NOT NULL DEFAULT false,
 created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE wf_canonical_staging.immutable_source_snapshot_chunks (
 manifest_sha256 text NOT NULL REFERENCES wf_canonical_staging.immutable_source_snapshots(manifest_sha256),
 chunk_index integer NOT NULL CHECK(chunk_index>=0),
 raw_row_ids uuid[] NOT NULL CHECK(cardinality(raw_row_ids) BETWEEN 1 AND 5000),
 canonical_sha256 text NOT NULL CHECK(canonical_sha256 ~ '^[a-f0-9]{64}$'),
 created_at timestamptz NOT NULL DEFAULT now(),
 PRIMARY KEY(manifest_sha256,chunk_index)
);
ALTER TABLE wf_canonical_staging.immutable_source_snapshots ENABLE ROW LEVEL SECURITY;
ALTER TABLE wf_canonical_staging.immutable_source_snapshot_chunks ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON wf_canonical_staging.immutable_source_snapshots,
 wf_canonical_staging.immutable_source_snapshot_chunks FROM PUBLIC,anon,authenticated,service_role;
ALTER TABLE wf_canonical_staging.normalization_jobs_v2
 ALTER COLUMN capture_run_key DROP NOT NULL,
 ADD COLUMN immutable_snapshot_sha256 text REFERENCES wf_canonical_staging.immutable_source_snapshots(manifest_sha256),
 ADD CONSTRAINT normalization_job_one_boundary CHECK(num_nonnulls(capture_run_key,immutable_snapshot_sha256)=1);

CREATE FUNCTION public.register_immutable_source_snapshot(p_manifest_canonical text,p_manifest_sha256 text) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE m jsonb; c jsonb; previous_id text:=''; n bigint:=0; old jsonb; i integer:=0;
BEGIN
 IF p_manifest_canonical IS NULL OR octet_length(p_manifest_canonical)>2000000
  OR p_manifest_sha256 IS NULL OR encode(extensions.digest(convert_to(p_manifest_canonical,'UTF8'),'sha256'),'hex') IS DISTINCT FROM p_manifest_sha256 THEN
  RAISE EXCEPTION 'snapshot_manifest_hash_invalid' USING ERRCODE='22023'; END IF;
 m=p_manifest_canonical::jsonb;
 IF m->>'contract' IS DISTINCT FROM 'WF_IMMUTABLE_SOURCE_SNAPSHOT_V2' OR m->>'status' IS DISTINCT FROM 'COMPLETE'
  OR m->>'isolation' IS DISTINCT FROM 'REPEATABLE READ / CONSISTENT SNAPSHOT / READ ONLY'
  OR jsonb_typeof(m->'chunks') IS DISTINCT FROM 'array' OR jsonb_array_length(m->'chunks') NOT BETWEEN 1 AND 10000
  OR (m->>'expected_rows')::bigint IS DISTINCT FROM (m->>'rows')::bigint OR (m->>'rows')::bigint<=0
  OR nullif(m->>'source_system','') IS NULL OR nullif(m->>'source_database','') IS NULL OR nullif(m->>'source_table','') IS NULL THEN
  RAISE EXCEPTION 'snapshot_manifest_contract_invalid' USING ERRCODE='22023'; END IF;
 FOR c IN SELECT value FROM jsonb_array_elements(m->'chunks') LOOP
  IF (c->>'rows')::integer NOT BETWEEN 1 AND 5000 OR c->>'canonical_sha256' !~ '^[a-f0-9]{64}$'
   OR nullif(c->>'first_id','') IS NULL OR nullif(c->>'last_id','') IS NULL
   OR (c->>'first_id') COLLATE "C"<=previous_id COLLATE "C"
   OR (c->>'first_id') COLLATE "C">(c->>'last_id') COLLATE "C" THEN
   RAISE EXCEPTION 'snapshot_chunk_boundary_invalid' USING ERRCODE='22023'; END IF;
  n=n+(c->>'rows')::bigint;previous_id=c->>'last_id';i=i+1;
 END LOOP;
 IF n IS DISTINCT FROM (m->>'rows')::bigint OR m->'chunks'->0->>'first_id' IS DISTINCT FROM m->>'minimum_id'
  OR previous_id IS DISTINCT FROM m->>'maximum_id' THEN
  RAISE EXCEPTION 'snapshot_manifest_count_invalid' USING ERRCODE='22023'; END IF;
 INSERT INTO wf_canonical_staging.immutable_source_snapshots(manifest_sha256,manifest)
 VALUES(p_manifest_sha256,m) ON CONFLICT DO NOTHING;
 SELECT manifest INTO old FROM wf_canonical_staging.immutable_source_snapshots WHERE manifest_sha256=p_manifest_sha256;
 IF old IS DISTINCT FROM m THEN RAISE EXCEPTION 'snapshot_manifest_replay_changed' USING ERRCODE='22023'; END IF;
 RETURN jsonb_build_object('manifest_sha256',p_manifest_sha256,'expected_rows',n,'chunks',i);
END;
$$;

CREATE FUNCTION public.bind_immutable_source_snapshot_chunk(p_manifest_sha256 text,p_chunk_index integer,p_raw_row_ids uuid[]) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE s wf_canonical_staging.immutable_source_snapshots; c jsonb; n integer; unique_sources integer; ids uuid[]; content_hash text;
 first_id text; last_id text; prior wf_canonical_staging.immutable_source_snapshot_chunks;
BEGIN
 SELECT * INTO s FROM wf_canonical_staging.immutable_source_snapshots WHERE manifest_sha256=p_manifest_sha256 FOR UPDATE;
 IF NOT FOUND OR p_chunk_index IS NULL OR p_chunk_index<0 OR p_chunk_index>=jsonb_array_length(s.manifest->'chunks')
  OR p_raw_row_ids IS NULL OR cardinality(p_raw_row_ids) NOT BETWEEN 1 AND 5000 THEN
  RAISE EXCEPTION 'snapshot_chunk_request_invalid' USING ERRCODE='22023'; END IF;
 c=s.manifest->'chunks'->p_chunk_index;
 IF cardinality(p_raw_row_ids)<>(c->>'rows')::integer
  OR cardinality(p_raw_row_ids)<>(SELECT count(DISTINCT x) FROM unnest(p_raw_row_ids)x) THEN
  RAISE EXCEPTION 'snapshot_chunk_membership_invalid' USING ERRCODE='22023'; END IF;
 SELECT count(*),count(DISTINCT r.source_id),array_agg(r.id ORDER BY r.source_id COLLATE "C"),
  min(r.source_id COLLATE "C"),max(r.source_id COLLATE "C"),
  encode(extensions.digest(convert_to(string_agg(r.raw_payload_text||E'\n','' ORDER BY r.source_id COLLATE "C"),'UTF8'),'sha256'),'hex')
 INTO n,unique_sources,ids,first_id,last_id,content_hash
 FROM wf_canonical_staging.mariadb_raw_source_rows r WHERE r.id=ANY(p_raw_row_ids)
  AND (r.source_system,r.source_database,r.source_table)=(s.manifest->>'source_system',s.manifest->>'source_database',s.manifest->>'source_table')
  AND r.hash_algorithm='sha256' AND r.canonicalization_version='v1-json-keys-sorted-compact'
  AND r.raw_sha256=r.source_hash AND r.raw_payload->>'id'=r.source_id
  AND encode(extensions.digest(convert_to(r.raw_payload_text,'UTF8'),'sha256'),'hex')=r.source_hash;
 IF n<>(c->>'rows')::integer OR unique_sources<>n OR content_hash IS DISTINCT FROM c->>'canonical_sha256'
  OR first_id IS DISTINCT FROM c->>'first_id' OR last_id IS DISTINCT FROM c->>'last_id' THEN
  RAISE EXCEPTION 'snapshot_chunk_content_mismatch' USING ERRCODE='22023'; END IF;
 SELECT * INTO prior FROM wf_canonical_staging.immutable_source_snapshot_chunks
 WHERE manifest_sha256=p_manifest_sha256 AND chunk_index=p_chunk_index;
 IF FOUND THEN
  IF prior.raw_row_ids IS DISTINCT FROM ids OR prior.canonical_sha256 IS DISTINCT FROM content_hash THEN
   RAISE EXCEPTION 'snapshot_chunk_replay_changed' USING ERRCODE='22023'; END IF;
 ELSE
  IF s.sealed THEN RAISE EXCEPTION 'snapshot_already_sealed' USING ERRCODE='22023'; END IF;
  INSERT INTO wf_canonical_staging.immutable_source_snapshot_chunks(manifest_sha256,chunk_index,raw_row_ids,canonical_sha256)
  VALUES(p_manifest_sha256,p_chunk_index,ids,content_hash);
 END IF;
 RETURN jsonb_build_object('chunk_index',p_chunk_index,'rows',n,'canonical_sha256',content_hash);
END;
$$;

CREATE FUNCTION public.create_immutable_snapshot_normalization_job(p_manifest_sha256 text,p_job_name text) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE s wf_canonical_staging.immutable_source_snapshots; j wf_canonical_staging.normalization_jobs_v2;
 n bigint; chunks integer; inserted bigint;
BEGIN
 IF p_job_name IS NULL OR length(p_job_name) NOT BETWEEN 1 AND 160 THEN
  RAISE EXCEPTION 'snapshot_job_name_invalid' USING ERRCODE='22023'; END IF;
 PERFORM pg_advisory_xact_lock(724051,hashtext(p_job_name));
 SELECT * INTO s FROM wf_canonical_staging.immutable_source_snapshots WHERE manifest_sha256=p_manifest_sha256 FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'snapshot_not_registered' USING ERRCODE='22023'; END IF;
 SELECT * INTO j FROM wf_canonical_staging.normalization_jobs_v2 WHERE job_name=p_job_name;
 IF FOUND THEN
  IF j.immutable_snapshot_sha256 IS DISTINCT FROM p_manifest_sha256 THEN
   RAISE EXCEPTION 'snapshot_job_replay_changed' USING ERRCODE='22023'; END IF;
  RETURN to_jsonb(j);
 END IF;
 SELECT count(*),sum(cardinality(raw_row_ids)) INTO chunks,n FROM wf_canonical_staging.immutable_source_snapshot_chunks
 WHERE manifest_sha256=p_manifest_sha256;
 IF chunks<>jsonb_array_length(s.manifest->'chunks') OR n IS DISTINCT FROM (s.manifest->>'rows')::bigint THEN
  RAISE EXCEPTION 'snapshot_membership_incomplete' USING ERRCODE='22023'; END IF;
 UPDATE wf_canonical_staging.immutable_source_snapshots SET sealed=true WHERE manifest_sha256=p_manifest_sha256;
 INSERT INTO wf_canonical_staging.normalization_jobs_v2(job_name,capture_run_key,manifest_sha256,source_system,source_database,source_table,
 capture_checkpoint,expected_rows,immutable_snapshot_sha256)
 VALUES(p_job_name,NULL,p_manifest_sha256,s.manifest->>'source_system',s.manifest->>'source_database',s.manifest->>'source_table',s.manifest,n,p_manifest_sha256);
 INSERT INTO wf_canonical_staging.normalization_job_members_v2(job_name,raw_row_id,source_hash)
 SELECT p_job_name,r.id,r.source_hash FROM wf_canonical_staging.immutable_source_snapshot_chunks c
 CROSS JOIN LATERAL unnest(c.raw_row_ids) AS ids(id)
 JOIN wf_canonical_staging.mariadb_raw_source_rows r ON r.id=ids.id WHERE c.manifest_sha256=p_manifest_sha256;
 GET DIAGNOSTICS inserted=ROW_COUNT;
 IF inserted<>n THEN RAISE EXCEPTION 'snapshot_raw_membership_changed' USING ERRCODE='22023'; END IF;
 SELECT * INTO j FROM wf_canonical_staging.normalization_jobs_v2 WHERE job_name=p_job_name;
 RETURN to_jsonb(j);
END;
$$;
REVOKE ALL ON FUNCTION public.register_immutable_source_snapshot(text,text),
 public.bind_immutable_source_snapshot_chunk(text,integer,uuid[]),
 public.create_immutable_snapshot_normalization_job(text,text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.register_immutable_source_snapshot(text,text),
 public.bind_immutable_source_snapshot_chunk(text,integer,uuid[]),
 public.create_immutable_snapshot_normalization_job(text,text) TO service_role;
NOTIFY pgrst,'reload schema';
COMMIT;
