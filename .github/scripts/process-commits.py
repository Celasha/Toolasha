import json
import os

with open('/tmp/commits.json') as f:
    data = json.load(f)

lines = []
feat_lines = []
for c in data:
    msg = c['commit']['message'].splitlines()[0]
    sha = c['sha'][:7]
    url = c['html_url']
    # Skip release-please metadata and merge commits
    if msg.startswith('chore') or msg.startswith('Merge '):
        continue
    line = f'[`{sha}`]({url}) {msg}'
    lines.append(line)
    if msg.startswith('feat'):
        feat_lines.append(line)

body = '\n'.join(lines) if lines else 'No changes.'
if len(body) > 3900:
    body = body[:3900] + '\n...'

feat_body = '\n'.join(feat_lines)

with open(os.environ['GITHUB_ENV'], 'a') as f:
    f.write(f'COMMIT_LINES<<ENVEOF\n{body}\nENVEOF\n')
    f.write(f"HAS_FEATS={'true' if feat_lines else 'false'}\n")
    f.write(f'FEAT_LINES<<ENVEOF\n{feat_body}\nENVEOF\n')
