#!/usr/bin/env python3
"""One-time split (0.41.0): the studio page held both Live and Edit markup. This writes
studio.html with only Live's, and edit.html with only Edit's. From then on they're separate
pages, edited on their own. Each page's <body data-absent> lists the other page's elements
(id: tag) so the shared code gets a harmless stand-in for them instead of null.
    python3 tools/split_pages.py public/studio.html   (the full page)
"""
import json, re, sys
from html.parser import HTMLParser

VOID = {'input', 'br', 'img', 'meta', 'link', 'hr', 'source', 'col', 'area', 'base', 'embed', 'param', 'track', 'wbr'}


def spans(html, mode):
    """[(start, end, {id: tag})] of every element marked data-mode=mode (body excepted), outermost only."""
    lines = html.split('\n')
    offs = [0]
    for l in lines:
        offs.append(offs[-1] + len(l) + 1)
    absolute = lambda pos: offs[pos[0] - 1] + pos[1]

    class P(HTMLParser):
        def __init__(s):
            super().__init__(convert_charrefs=False)
            s.stack, s.out = [], []
        def handle_starttag(s, tag, attrs):
            a = dict(attrs)
            start = absolute(s.getpos())
            inside = next((x for x in reversed(s.stack) if x['mark']), None)
            mark = tag != 'body' and a.get('data-mode') == mode and not inside
            node = {'tag': tag, 'start': start, 'mark': mark, 'ids': {}}
            owner = node if mark else inside
            if owner is not None and a.get('id'):
                owner['ids'][a['id']] = tag
            if tag in VOID:
                if mark:
                    end = html.index('>', start) + 1
                    s.out.append((start, end, node['ids']))
                return
            s.stack.append(node)
        def handle_startendtag(s, tag, attrs):
            s.handle_starttag(tag, attrs)
            if tag not in VOID and s.stack and s.stack[-1]['tag'] == tag:
                n = s.stack.pop()
                if n['mark']:
                    s.out.append((n['start'], html.index('>', n['start']) + 1, n['ids']))
        def handle_endtag(s, tag):
            for i in range(len(s.stack) - 1, -1, -1):
                if s.stack[i]['tag'] == tag:
                    n = s.stack[i]
                    del s.stack[i:]
                    if n['mark']:
                        end = html.index('>', absolute(s.getpos())) + 1
                        s.out.append((n['start'], end, n['ids']))
                    return
    p = P()
    p.feed(html)
    return p.out


def without(html, mode):
    cut = sorted(spans(html, mode))
    absent, out, at = {}, [], 0
    for start, end, ids in cut:
        out.append(html[at:start])
        out.append(f'<!-- ({mode} only: on the {"Edit" if mode == "edit" else "Live studio"} page) -->')
        absent.update(ids)
        at = end
    out.append(html[at:])
    page = ''.join(out)
    tag = re.search(r'<body([^>]*)>', page)
    page = page[:tag.start()] + f"<body{tag.group(1)} data-absent='{json.dumps(absent, separators=(',', ':'))}'>" + page[tag.end():]
    return page, absent, len(cut)


if __name__ == '__main__':
    full = open(sys.argv[1]).read()
    live, a1, n1 = without(full, 'edit')
    edit, a2, n2 = without(full, 'live')
    edit = edit.replace('<title>', '<title data-page="edit">', 1).replace('<body data-mode="live"', '<body data-mode="edit"', 1)
    root = sys.argv[1].rsplit('/', 1)[0]
    open(f'{root}/studio.html', 'w').write(live)
    open(f'{root}/edit.html', 'w').write(edit)
    print(f'studio.html: {n1} Edit blocks out ({len(a1)} ids), {len(full) - len(live):+,} chars → {len(live):,}')
    print(f'edit.html:   {n2} Live blocks out ({len(a2)} ids), {len(full) - len(edit):+,} chars → {len(edit):,}')
