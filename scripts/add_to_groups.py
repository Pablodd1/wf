#!/usr/bin/env python3
"""Add 17869708366 to all 645 WhatsApp groups via Green API"""
import urllib.request, json, time

inst_id = "7105337075"
token = "ca6999ea72b643f2a41f65dcb09e4d19f19468af93a1457886"
my_number = "17869708366@c.us"

# Get groups
url = f"https://api.green-api.com/waInstance{inst_id}/getChats/{token}"
req = urllib.request.Request(url, method="POST", data=json.dumps({}).encode(), headers={"Content-Type": "application/json"})
with urllib.request.urlopen(req, timeout=30) as resp:
    d = json.loads(resp.read().decode())

groups = [c for c in d if str(c.get('id', '')).endswith('@g.us')]
print(f"Total groups: {len(groups)}", flush=True)

added = 0
already = 0
failed = 0
errors = []

for i, g in enumerate(groups):
    group_id = g.get('id', '')
    group_name = str(g.get('name', ''))[:30]
    
    add_url = f"https://api.green-api.com/waInstance{inst_id}/addGroupParticipant/{token}"
    payload = json.dumps({"groupId": group_id, "participantChatId": my_number}).encode()
    add_req = urllib.request.Request(add_url, data=payload, headers={"Content-Type": "application/json"}, method="POST")
    
    try:
        with urllib.request.urlopen(add_req, timeout=15) as add_resp:
            result = json.loads(add_resp.read().decode())
            added += 1
    except urllib.error.HTTPError as e:
        err = e.read().decode()
        if 'already' in err.lower() or 'participant' in err.lower() or '403' in str(e.code):
            already += 1
        else:
            failed += 1
            if len(errors) < 10:
                errors.append(f"{group_name}: {err[:100]}")
    except Exception as e:
        failed += 1
        if len(errors) < 10:
            errors.append(f"{group_name}: {str(e)[:100]}")
    
    if (i + 1) % 25 == 0 or i == len(groups) - 1:
        print(f"[{i+1}/{len(groups)}] Added: {added} | Already: {already} | Failed: {failed}", flush=True)
    
    time.sleep(0.2)

print(f"\n=== DONE ===", flush=True)
print(f"Added: {added}", flush=True)
print(f"Already member: {already}", flush=True)
print(f"Failed: {failed}", flush=True)
if errors:
    print(f"\nFirst errors:", flush=True)
    for e in errors:
        print(f"  {e}", flush=True)

# Save results
with open("/home/jasme/wf/add_groups_result.json", "w") as f:
    json.dump({"added": added, "already": already, "failed": failed, "total": len(groups), "errors": errors}, f, indent=2)
