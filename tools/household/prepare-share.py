"""Export a source review snapshot without Git history, runtime data, or local evidence.

Run --audit first. Private matching terms are supplied in a local JSON file and
are never copied into the export or printed in the audit output.
"""
import argparse
import collections
import difflib
import hashlib
import json
from pathlib import Path
import re
import subprocess
import zipfile

ROOT = Path(__file__).resolve().parents[2]
BASE = 'ac8469def67ccc5dcabbea123d023fcb5e380429'
DOCS = {
    'SPEC.md', 'DECISIONS.md', 'OPERATIONS.md', 'PRIVACY.md', 'ANDROID-TV.md',
    'ANDROID-TV-ENTERPRISE-PLAYER-RESEARCH.md', 'FORK-ADDITIONS.md', 'SHARING.md', 'ACCEPTANCE.md',
    'EPISODE-RECREATION.md',
}
RULES = {
    'user-path': re.compile(r'(?i)[a-z]:[\\/]+(?:Users|Dev)[\\/]+[^\s\"\'<>`]+'),
    'email': re.compile(r'\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b', re.I),
    'credential-url': re.compile(r'(?i)(?:[?&]|\b)(?:token|api_key|apikey|access_token|torbox|realdebrid|premiumize)=[A-Za-z0-9_-]{16,}'),
    'private-key': re.compile(r'-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----'),
    'service-token': re.compile(r'\b(?:gh[pousr]_[A-Za-z0-9]{30,}|github_pat_[A-Za-z0-9_]{30,}|AKIA[A-Z0-9]{16})\b'),
}


def git(*args):
    return subprocess.check_output(['git', '-c', 'core.quotepath=false', *args], cwd=ROOT, stderr=subprocess.DEVNULL)


def candidates():
    paths = git('ls-files', '-z', '--cached', '--others', '--exclude-standard').decode().split('\0')
    return sorted({p for p in paths if p and (ROOT / p).is_file()})


def allowed(path):
    p = Path(path)
    if p.parts[0] in {'.git', '.github', 'artifacts', '.agents', '.codex'}:
        return False
    if path.startswith('docs/household/'):
        return p.name in DOCS
    if p.suffix.lower() in {'.log', '.sqlite', '.db', '.jks', '.keystore', '.apk', '.exe', '.csv', '.tsv', '.har'}:
        return False
    if p.name in {'local.properties', 'keystore.properties', 'local-processes.json'}:
        return False
    if p.name.startswith('.env') and p.name != '.env.example':
        return False
    return not any(part in {'node_modules', '.gradle', '.venv', '__pycache__', 'build', 'test-results', 'playwright-report'} for part in p.parts)


def read_text(data):
    if b'\0' in data:
        return None
    try:
        return data.decode('utf-8-sig').replace('\r\n', '\n')
    except UnicodeDecodeError:
        return None


def findings(text, private_terms, public_values=()):
    hits = {}
    for name, pattern in RULES.items():
        matches = [m.group() for m in pattern.finditer(text)]
        matches = [value for value in matches if value not in public_values and
            not (name == 'email' and (value.startswith(('this@', 'super@')) or
                 re.search(r'(?i)@(?:example\.(?:com|org|net)|[^@]+\.(?:invalid|test|example))$', value))) and
            not (name == 'credential-url' and re.search(r'(?i)synthetic|fixture|never-forward', value)) and
            not (name == 'user-path' and ('...' in value or '\u2026' in value))]
        if matches:
            hits[name] = len(matches)
    count = sum(len(re.findall(re.escape(term), text, re.I)) for term in private_terms if term)
    if count:
        hits['private-term'] = count
    return hits


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--audit', action='store_true')
    parser.add_argument('--private-rules', type=Path, required=True)
    parser.add_argument('--out', type=Path)
    args = parser.parse_args()
    rules = json.loads(args.private_rules.read_text(encoding='utf-8-sig'))
    terms = rules.get('terms', [])
    replacements = rules.get('replacements', {})
    all_paths = candidates()
    included = [p for p in all_paths if allowed(p)]
    audit = []
    payload = {}
    public_values = set()
    for path in included:
        input_path = 'docs/household/PUBLIC-ACCEPTANCE.md' if path == 'docs/household/ACCEPTANCE.md' else path
        data = (ROOT / input_path).read_bytes()
        text = read_text(data)
        if text is not None:
            if path == 'README.md':
                text = ("# Stremflix development fork\n\n"
                        "Source review snapshot of a fork of [dx.bi](https://github.com/notdxbi/dxbi-stremio). "
                        "Start with the [additions and review guide](docs/household/FORK-ADDITIONS.md), "
                        "[validation limits](docs/household/ACCEPTANCE.md), and "
                        "[episode lifecycle fix](docs/household/EPISODE-RECREATION.md).\n\n"
                        "This snapshot includes no application downloads. Links in the original README below "
                        "refer to upstream dx.bi releases, which do not contain these fork changes. "
                        "Dolby Vision parity remains unresolved.\n\n---\n\n" + text)
            for private, public in replacements.items():
                text = re.sub(re.escape(private), lambda _: public, text, flags=re.I)
            if any(pattern.search(text) for pattern in RULES.values()):
                try:
                    original = read_text(git('show', f'{BASE}:{path}')) or ''
                    # Preserve public upstream contact metadata, never credentials.
                    public_values.update(RULES['email'].findall(original))
                except subprocess.CalledProcessError:
                    pass
            hits = findings(text, terms, public_values)
            if hits:
                # Only public relative paths and category counts; never matching values.
                audit.append({'path': path, 'categories': hits})
            data = text.encode('utf-8')
        else:
            for term in terms:
                if term and any(term.encode(enc).lower() in data.lower() for enc in ('utf-8', 'utf-16le')):
                    audit.append({'path': path, 'categories': {'private-term-in-binary': 1}})
        payload[path] = data
    if args.audit:
        print(json.dumps({'included': len(included), 'excluded': len(all_paths) - len(included), 'findings': audit}, indent=2))
        return
    if not args.out:
        parser.error('--out is required for an export')
    if audit:
        print(json.dumps({'status': 'blocked', 'findings': audit}, indent=2))
        raise SystemExit(1)
    out = args.out.resolve()
    if not out.is_relative_to(ROOT / 'artifacts' / 'sharing'):
        parser.error('--out must be inside artifacts/sharing')
    out.mkdir(parents=True, exist_ok=False)
    source = out / 'stremflix-source'
    inventory = []
    patch = []
    for path, data in payload.items():
        target = source / path
        target.parent.mkdir(parents=True, exist_ok=True)
        target.write_bytes(data)
        try:
            previous = git('show', f'{BASE}:{path}')
        except subprocess.CalledProcessError:
            previous = None
        previous_text = read_text(previous) if previous is not None else None
        comparable_previous = previous_text.encode('utf-8') if previous_text is not None else previous
        status = 'added' if previous is None else 'unchanged' if comparable_previous == data else 'modified'
        inventory.append({'path': path, 'status': status, 'sha256': hashlib.sha256(data).hexdigest(), 'bytes': len(data)})
        old_text, new_text = read_text(previous or b''), read_text(data)
        if status != 'unchanged' and old_text is not None and new_text is not None:
            for line in difflib.unified_diff(old_text.splitlines(keepends=True), new_text.splitlines(keepends=True),
                    fromfile=f'a/{path}' if previous is not None else '/dev/null', tofile=f'b/{path}'):
                patch.append(line if line.endswith('\n') else line + '\n\\ No newline at end of file\n')
    patch_text = ''.join(patch)
    # Scan the patch too: old context must not reintroduce private data.
    if findings(patch_text, terms, public_values):
        raise RuntimeError('Patch audit failed; inspect privately before sharing this directory')
    (source / 'UPSTREAM-CHANGES.patch').write_bytes(patch_text.encode('utf-8'))
    summary = {
        'upstream': 'https://github.com/notdxbi/dxbi-stremio', 'upstreamCommit': BASE,
        'gitHistoryIncluded': False, 'runtimeDataIncluded': False, 'workflowsIncluded': False,
        'credentialAndPersonalPatternFindings': 0, 'sourceFiles': len(inventory),
        'changes': dict(collections.Counter(item['status'] for item in inventory)), 'files': inventory,
    }
    (source / 'SOURCE-MANIFEST.json').write_text(json.dumps(summary, indent=2) + '\n', encoding='utf-8')
    archive = out / 'stremflix-source-review.zip'
    with zipfile.ZipFile(archive, 'w', zipfile.ZIP_DEFLATED) as zipped:
        for path in sorted(source.rglob('*')):
            if path.is_file():
                info = zipfile.ZipInfo(path.relative_to(out).as_posix(), date_time=(2026, 1, 1, 0, 0, 0))
                info.compress_type = zipfile.ZIP_DEFLATED
                info.external_attr = 0o100644 << 16
                zipped.writestr(info, path.read_bytes())
    digest = hashlib.sha256(archive.read_bytes()).hexdigest()
    (out / 'SHA256SUMS.txt').write_text(f'{digest}  {archive.name}\n', encoding='utf-8')
    print(json.dumps({'archive': str(archive), 'sourceFiles': len(inventory), 'changes': summary['changes'], 'sha256': digest}))


if __name__ == '__main__':
    main()
