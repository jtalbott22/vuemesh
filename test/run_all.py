#!/usr/bin/env python3
"""Run every VUEMesh test, one at a time, and write a short results file to paste back.

    python3 test/run_all.py                 # everything (about 45-90 minutes)
    python3 test/run_all.py editor kiosk    # only suites whose names contain these words
    python3 test/run_all.py --failed        # only the ones that failed last time
    python3 test/run_all.py --list          # just list the suites

It starts the dev server itself (on port 8790, or --port), runs the unit tests (node), then each
end-to-end suite with a time limit, and writes test-results.txt in the project folder: a pass/fail
line for each, and the last lines of each failure's output (that's the part to send).
Needs: node, Python 3 with playwright (pip install playwright; python3 -m playwright install chromium).
"""
import json
import os
import subprocess
import sys
import time
import urllib.request

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
TEST = os.path.join(ROOT, 'test')
RESULTS = os.path.join(ROOT, 'test-results.txt')
LAST = os.path.join(ROOT, '.test-last.json')


def suites():
    return sorted(f[:-3] for f in os.listdir(TEST) if f.startswith('e2e') and f.endswith('.py'))


def wait_up(url, seconds=30):
    for _ in range(seconds * 4):
        try:
            urllib.request.urlopen(url, timeout=2)
            return True
        except Exception:
            time.sleep(0.25)
    return False


def tail(text, n=15):
    lines = [l for l in text.replace('\r', '\n').split('\n') if l.strip()]
    return '\n'.join('    ' + l[:300] for l in lines[-n:])


def main():
    args = [a for a in sys.argv[1:] if not a.startswith('--')]
    flags = {a for a in sys.argv[1:] if a.startswith('--')}
    port = 8790
    for a in sys.argv[1:]:
        if a.startswith('--port='):
            port = int(a.split('=', 1)[1])
    names = suites()
    if '--list' in flags:
        return print('\n'.join(names))
    if '--failed' in flags and os.path.exists(LAST):
        names = [n for n in names if n in json.load(open(LAST)).get('failed', [])]
    if args:
        names = [n for n in names if any(a in n for a in args)]
    # what the suites need, checked up front (so a missing package isn't four failures)
    missing = []
    for mod, pip in (('playwright', 'playwright'), ('PIL', 'pillow')):
        try:
            __import__(mod)
        except ImportError:
            missing.append(f'{mod} (pip install {pip})')
    import shutil
    if not shutil.which('ffmpeg'):
        missing.append('ffmpeg (on the PATH; e2e_render and some checks use it)')
    if missing:
        print('Missing: ' + '; '.join(missing))
        if any(m.startswith('playwright') for m in missing):
            sys.exit(1)
    base = f'http://localhost:{port}'
    env = {**os.environ, 'BASE': base, 'PORT': str(port)}
    server = None
    if not wait_up(base, 1):
        server = subprocess.Popen(['node', 'dev/server.mjs'], cwd=ROOT, env=env, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
        if not wait_up(base):
            sys.exit(f'The dev server did not start on {base}')
    out, failed, started = [], [], time.time()
    head = f'VUEMesh tests, {time.strftime("%Y-%m-%d %H:%M")}, {os.cpu_count()} CPUs'
    try:
        version = json.load(open(os.path.join(ROOT, 'package.json')))['version']
        head += f', v{version}'
    except Exception:
        pass
    if missing:
        head += '\nMissing: ' + '; '.join(missing)
    print(head)
    # (the import check always runs first: if it fails, every page that loads the module is broken)
    runs = [('unit: imports', ['node', 'test/imports.test.mjs'])]
    runs += [] if args or '--failed' in flags else [('unit: core', ['node', 'test/core.test.mjs']), ('unit: sequence', ['node', 'test/sequence.test.mjs']), ('unit: quality', ['node', 'test/quality.test.mjs']), ('unit: show log', ['node', 'test/showlog.test.mjs'])]
    runs += [(n, [sys.executable, f'test/{n}.py']) for n in names]
    for label, cmd in runs:
        t0 = time.time()
        print(f'  {label} ...', end='', flush=True)
        try:
            p = subprocess.run(cmd, cwd=ROOT, env=env, capture_output=True, text=True, timeout=900)
            ok, text = p.returncode == 0, (p.stdout or '') + (p.stderr or '')
        except subprocess.TimeoutExpired as e:
            ok, text = False, f'(stopped after 15 minutes)\n{(e.stdout or b"").decode(errors="replace") if isinstance(e.stdout, bytes) else (e.stdout or "")}'
        secs = int(time.time() - t0)
        passed_steps = sum(1 for l in text.split('\n') if l.startswith('ok '))
        line = f'{"PASS" if ok else "FAIL"}  {label}  ({secs} s, {passed_steps} steps passed)'
        print(f'\r  {line}')
        out.append(line)
        if not ok:
            failed.append(label)
            out.append(tail(text))
    if server:
        server.terminate()
    summary = f'{len(runs) - len(failed)} of {len(runs)} passed in {int((time.time() - started) / 60)} min' + (f'; failed: {", ".join(failed)}' if failed else '')
    with open(RESULTS, 'w', encoding='utf-8') as f:
        f.write(head + '\n' + summary + '\n\n' + '\n'.join(out) + '\n')
    json.dump({'failed': failed}, open(LAST, 'w'))
    print(f'\n{summary}\nResults: {RESULTS}' + (' (send the FAIL parts)' if failed else ''))
    sys.exit(1 if failed else 0)


if __name__ == '__main__':
    main()
