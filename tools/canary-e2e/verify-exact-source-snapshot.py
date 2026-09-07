from pathlib import Path
import subprocess,json,hashlib,uuid,datetime
repo=Path(__file__).resolve().parents[2]
output=repo/'audit-output/disposable-replay'
output.mkdir(parents=True,exist_ok=True)
def canonical(v):return json.dumps(v,sort_keys=True,separators=(',',':'),ensure_ascii=False)
def sha(s):return hashlib.sha256(s.encode()).hexdigest()
def literal(s):return "'"+str(s).replace("'","''")+"'"
report={'recorded_at':datetime.datetime.now(datetime.timezone.utc).isoformat(),'synthetic_only':True,'production_mutations':0,'databases':[]}
for container,db in [('wf-final-disposable-pg18','wf_production_forward_20260907'),('supabase_db_wf-final-disposable','postgres')]:
 def query(q):return subprocess.run(['docker','exec','-i',container,'psql','-X','-U','postgres','-d',db,'-v','ON_ERROR_STOP=1','-At'],input=q.encode(),capture_output=True)
 def ok(q):
  r=query(q);assert r.returncode==0,r.stderr.decode()[-1200:];return r.stdout.decode().strip()
 def rejected(q,code):
  r=query(q);assert r.returncode!=0 and code in r.stderr.decode(),r.stderr.decode()[-1200:]
 for name in ['20260907185000_dealer_directory_prerequisites.sql','20260907185500_dealer_directory_optional_columns.sql','20260909030000_exact_source_snapshot_membership.sql']:
  if name!='20260909030000_exact_source_snapshot_membership.sql' or ok("SELECT to_regprocedure('public.register_immutable_source_snapshot(text,text)') IS NULL;")=='t':
   ok((repo/'supabase/migrations'/name).read_text())
 scope='SYNTHETIC-SNAPSHOT-'+str(uuid.uuid4());ids=[];payloads=[];sourceids=['SYNTHETIC-0001','SYNTHETIC-0002','SYNTHETIC-0003']
 for i,sid in enumerate(sourceids+['SYNTHETIC-0001','SYNTHETIC-EXTRA']):
  rid=str(uuid.uuid4());ids.append(rid);raw={'id':sid,'description':'SYNTHETIC WTS Rolex 126610LN USD 12000','synthetic_fixture':True,'revision':i};text=canonical(raw);payloads.append(text)
  ok("INSERT INTO wf_canonical_staging.mariadb_raw_source_rows(id,source_system,source_database,source_table,source_id,source_record_id,source_hash,raw_sha256,raw_payload_text,raw_payload,raw_message,raw_message_source) VALUES("+','.join(literal(x) for x in [rid,scope,'disposable','auctions',sid,sid,sha(text),sha(text),text,text,raw['description'],'description'])+");")
 chunks=[{'rows':2,'first_id':sourceids[0],'last_id':sourceids[1],'canonical_sha256':sha('\n'.join(payloads[:2])+'\n')},{'rows':1,'first_id':sourceids[2],'last_id':sourceids[2],'canonical_sha256':sha(payloads[2]+'\n')}]
 m={'contract':'WF_IMMUTABLE_SOURCE_SNAPSHOT_V2','status':'COMPLETE','isolation':'REPEATABLE READ / CONSISTENT SNAPSHOT / READ ONLY','source_system':scope,'source_database':'disposable','source_table':'auctions','rows':3,'expected_rows':3,'minimum_id':sourceids[0],'maximum_id':sourceids[2],'chunks':chunks}
 text=canonical(m);digest=sha(text);register="SELECT public.register_immutable_source_snapshot("+literal(text)+','+literal(digest)+');'
 rejected("SELECT public.register_immutable_source_snapshot("+literal(text)+','+literal('0'*64)+');','snapshot_manifest_hash_invalid')
 first=ok(register);assert ok(register)==first
 job='SYNTHETIC-JOB-'+str(uuid.uuid4());create="SELECT public.create_immutable_snapshot_normalization_job("+literal(digest)+','+literal(job)+');'
 rejected(create,'snapshot_membership_incomplete')
 def bind(index,rs):return "SELECT public.bind_immutable_source_snapshot_chunk("+literal(digest)+','+str(index)+',ARRAY['+','.join(literal(x) for x in rs)+']::uuid[]);'
 rejected(bind(0,[ids[0],ids[0]]),'snapshot_chunk_membership_invalid')
 rejected(bind(0,[ids[3],ids[1]]),'snapshot_chunk_content_mismatch')
 rejected(bind(0,[ids[0],ids[4]]),'snapshot_chunk_content_mismatch')
 a=ok(bind(0,ids[:2]));assert ok(bind(0,list(reversed(ids[:2]))))==a
 rejected(create,'snapshot_membership_incomplete');ok(bind(1,[ids[2]]));created=json.loads(ok(create));assert created['expected_rows']==3 and created['capture_run_key'] is None
 assert json.loads(ok(create))==created
 members=json.loads(ok("SELECT json_agg(raw_row_id ORDER BY raw_row_id) FROM wf_canonical_staging.normalization_job_members_v2 WHERE job_name="+literal(job)+';'));assert sorted(members)==sorted(ids[:3])
 lease=str(uuid.uuid4());claimed=json.loads(ok("SELECT public.claim_normalization_batch_v2("+literal(job)+','+literal(lease)+',500);'));assert sorted(x['raw_row_id'] for x in claimed)==sorted(ids[:3])
 denied=ok("SELECT count(*) FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='public' AND p.proname IN ('register_immutable_source_snapshot','bind_immutable_source_snapshot_chunk','create_immutable_snapshot_normalization_job') AND (has_function_privilege('anon',p.oid,'execute') OR has_function_privilege('authenticated',p.oid,'execute'));");assert denied=='0'
 entry={'container':container,'database':db,'status':'PASS','checks':['wrong manifest digest rejected','manifest replay exact','incomplete snapshot cannot create job','duplicate membership rejected','different version and outside row rejected','chunk replay order-independent','exact three-row frozen job excludes newer version and outside scope','existing worker claims exact snapshot membership','public roles cannot execute snapshot management'],'migration_sha256':hashlib.sha256((repo/'supabase/migrations/20260909030000_exact_source_snapshot_membership.sql').read_bytes()).hexdigest()};report['databases'].append(entry);print(json.dumps(entry),flush=True)
report['status']='PASS';(output/'exact-snapshot-membership-pg15-pg18.json').write_text(json.dumps(report,indent=2))
