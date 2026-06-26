#!/usr/bin/env python3
import os, runpy, sys
os.environ['SUPABASE_KEY'] = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImJwdHJ2Zm5jcHBiam5jaHNheHRiIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc4MTU2MjYzMSwiZXhwIjoyMDk3MTM4NjMxfQ.x1KpnBCtgcn02hiBJfuNkm3FYq6elHv3Gnys62nu8SU"
os.environ['SUPABASE_URL'] = "https://bptrvfncppbjnchsaxtb.supabase.co"
script = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'mysql_to_supabase.py')
sys.argv = [script]
runpy.run_path(script, run_name='__main__')
