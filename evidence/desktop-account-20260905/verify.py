"""Verify included evidence and current source identities; requires Python 3 and Git."""
import hashlib
import json
from pathlib import Path
import subprocess

packet = Path(__file__).resolve().parent
repo = packet.parent.parent
manifest = json.loads((packet / 'manifest.json').read_text(encoding='utf-8'))
problems = []
for row in manifest['files']:
    path = packet / row['path']
    if not path.is_file():
        problems.append('Missing payload: ' + row['path'])
        continue
    data = path.read_bytes()
    if len(data) != row['bytes'] or hashlib.sha256(data).hexdigest() != row['sha256']:
        problems.append('Changed payload: ' + row['path'])
actual = {p.relative_to(packet).as_posix() for p in packet.rglob('*') if p.is_file()}
expected = {r['path'] for r in manifest['files']} | {'manifest.json'}
if actual != expected:
    problems.append('Packet inventory differs from manifest')
source_checks = []
for row in manifest['source']:
    path = repo / row['path']
    if not path.is_file():
        problems.append('Missing source: ' + row['path'])
        continue
    raw_exact = hashlib.sha256(path.read_bytes()).hexdigest() == row['sha256']
    actual_blob = subprocess.check_output(['git', '--no-optional-locks', 'hash-object', '--path=' + row['path'], str(path)], cwd=repo, text=True).strip()
    git_exact = actual_blob == row['gitBlobSha1']
    if not git_exact:
        problems.append('Changed source: ' + row['path'])
    source_checks.append({'path': row['path'], 'rawExact': raw_exact, 'gitNormalizedExact': git_exact})
print(json.dumps({'passed': not problems, 'includedPayloads': len(manifest['files']), 'source': source_checks,
    'retainedOnlyCustodyFiles': 7, 'retainedOnlyBytesVerified': False,
    'scope': 'Included payload and source identity only; no new runtime, browser, Office, production or whole-product grade',
    'problems': problems}, indent=2))
raise SystemExit(1 if problems else 0)
