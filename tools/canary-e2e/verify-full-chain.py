import hashlib, json, subprocess, pathlib, datetime, sys, time
root = pathlib.Path(__file__).resolve().parents[2]
major = '18' if '--pg18' in sys.argv else '15'
output_dir = pathlib.Path(sys.argv[sys.argv.index('--output-dir')+1]) if '--output-dir' in sys.argv else root/'audit-output/disposable-replay'
output_dir.mkdir(parents=True, exist_ok=True)
output = output_dir/('full-chain-pg'+major+'.json')
container = 'wf-final-disposable-pg18' if major == '18' else 'supabase_db_wf-final-disposable'
database = 'wf_full_replay' if '--fresh-db' in sys.argv else 'postgres'
def query(sql):
    return subprocess.run(['docker','exec','-i',container,'psql','-X','-U','postgres','-d',database,'-v','ON_ERROR_STOP=1','-At'], input=sql, stdout=subprocess.PIPE, stderr=subprocess.PIPE)
if major == '18':
    subprocess.run(['docker','start',container],stdout=subprocess.DEVNULL,check=True)
for attempt in range(20):
    identity = query(b"select version();")
    if identity.returncode == 0: break
    time.sleep(0.5)
if identity.returncode: raise SystemExit('Disposable database unavailable')
report = {'executed_at': datetime.datetime.now(datetime.timezone.utc).isoformat(), 'container': container, 'production_contacted': False,
          'database': database, 'version': identity.stdout.decode().strip(), 'migrations': [], 'status': 'RUNNING'}
files = sorted((root/'supabase/migrations').glob('*.sql'))
passed = set()
if '--resume' in sys.argv:
    previous = json.loads(output.read_text())
    assert previous['container'] == container and previous['version'] == report['version'] and previous['database'] == database
    output.with_suffix('.previous.json').write_text(json.dumps(previous,indent=2))
    report['migrations'] = [entry for entry in previous['migrations'] if entry['status'] == 'PASS']
    passed = {entry['name'] for entry in report['migrations']}
    report['bootstrap_supplements'] = previous.get('bootstrap_supplements',[])
    for entry in report['migrations']:
        assert hashlib.sha256((root/'supabase/migrations'/entry['name']).read_bytes()).hexdigest() == entry['sha256']
for file in files:
    if file.name in passed: continue
    bootstrap = root/'tools/canary-e2e/bootstrap'/('before-'+file.name.split('_')[0]+'.sql')
    if bootstrap.exists():
        bootstrap_data = bootstrap.read_bytes()
        result = query(b"SET wf.disposable_bootstrap = 'true';\n"+bootstrap_data)
        report.setdefault('bootstrap_supplements',[]).append({'before':file.name,'file':bootstrap.name,
            'sha256':hashlib.sha256(bootstrap_data).hexdigest(),'status':'PASS' if result.returncode == 0 else 'FAIL'})
        if result.returncode:
            report['status']='BOOTSTRAP_FAILED'
            report['bootstrap_supplements'][-1]['errors']=[line for line in result.stderr.decode(errors='replace').splitlines() if 'ERROR:' in line]
            break
    data = file.read_bytes()
    executed_data = data
    overlay = root/'tools/canary-e2e/bootstrap'/(file.name+'.replay.json')
    if overlay.exists():
        rules = json.loads(overlay.read_text())
        assert rules['original_sha256'] == hashlib.sha256(data).hexdigest() or rules['canonical_lf_sha256'] == hashlib.sha256(data.replace(b'\r\n',b'\n')).hexdigest()
        for rule in rules['replacements']:
            old, new = rule['old'].encode(), rule['new'].encode()
            assert executed_data.count(old) == 1
            executed_data = executed_data.replace(old,new)
    result = query(executed_data)
    entry = {'name': file.name, 'sha256': hashlib.sha256(data).hexdigest(), 'status': 'PASS' if result.returncode == 0 else 'FAIL'}
    if overlay.exists():
        entry['disposable_replay_overlay'] = overlay.name
        entry['executed_sha256'] = hashlib.sha256(executed_data).hexdigest()
    if result.returncode:
        # Empty, disposable database; output only error lines, never query results.
        entry['errors'] = [line for line in result.stderr.decode(errors='replace').splitlines() if 'ERROR:' in line][:5]
        report['status'] = 'FAIL'
    report['migrations'].append(entry)
    output.write_text(json.dumps(report,indent=2))
    print(file.name, entry['status'], flush=True)
    if result.returncode: break
else: report['status'] = 'PASS'
report['expected_migration_count'] = len(files)
report['executed_migration_count'] = len(report['migrations'])
output.write_text(json.dumps(report,indent=2))
print(json.dumps({k:report[k] for k in ['status','executed_migration_count','expected_migration_count']}))
