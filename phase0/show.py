# Résume phase0/logs/events.jsonl (une ligne par requête de hook + réponse).
import json, sys
for l in open('phase0/logs/events.jsonl', encoding='utf-8'):
    e = json.loads(l); b = e.get('body')
    if 'url' in e:
        b = b if isinstance(b, dict) else {}
        rest = {k: v for k, v in b.items() if k not in ('transcript_path', 'cwd', 'session_id', 'hook_event_name', 'prompt_id', 'effort', 'permission_mode')}
        print(e['url'], b.get('hook_event_name'), b.get('tool_name') or '', json.dumps(rest, ensure_ascii=False)[:int(sys.argv[1]) if len(sys.argv) > 1 else 260])
    elif e.get('out'):
        print('   -> REPLY', json.dumps(e['out'], ensure_ascii=False)[:200])
