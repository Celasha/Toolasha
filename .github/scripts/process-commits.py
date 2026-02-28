import os
import re

body = os.environ.get('PR_BODY', '')

lines = []
feat_lines = []

for line in body.splitlines():
    # Match bullet lines like: * some message (abc1234)
    m = re.match(r'^\*\s+(.+?)\s+\(([0-9a-f]{7,})\)$', line.strip())
    if not m:
        continue
    msg, sha = m.group(1), m.group(2)
    # Skip chore entries
    if msg.startswith('chore') or msg.startswith('Merge '):
        continue
    repo = os.environ.get('GITHUB_REPOSITORY', '')
    url = f'https://github.com/{repo}/commit/{sha}'
    entry = f'[`{sha}`]({url}) {msg}'
    lines.append(entry)
    if msg.startswith('feat'):
        feat_lines.append(entry)

body_out = '\n'.join(lines) if lines else 'No changes.'
if len(body_out) > 3900:
    body_out = body_out[:3900] + '\n...'

feat_body = '\n'.join(feat_lines)

with open(os.environ['GITHUB_ENV'], 'a') as f:
    f.write(f'COMMIT_LINES<<ENVEOF\n{body_out}\nENVEOF\n')
    f.write(f"HAS_FEATS={'true' if feat_lines else 'false'}\n")
    f.write(f'FEAT_LINES<<ENVEOF\n{feat_body}\nENVEOF\n')
