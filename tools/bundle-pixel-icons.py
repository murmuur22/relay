"""Rebuild Relay's bounded free Pixelarticons path catalog from a pinned npm tarball.
No package scripts, font files, CDN, Pro assets or arbitrary SVG markup are imported.
"""
import base64
import hashlib
import json
import re
import sys
import tarfile
import xml.etree.ElementTree as ET
from pathlib import Path

INTEGRITY = '4taoDCleft9RtzVHLA73VDnRBwJNqlwbW8ShO6S0G9b+bM5ArGe1MVFW9xpromuPvQgVUYCSjRxNAQuNtADqyA=='
GROUPS = {
    'Web and communication': 'home bookmark bookmarks link external-link globe mail chat message at cloud inbox rss',
    'Work and organization': 'folder archive book book-open notes note file calendar clipboard checklist briefcase calculator clock search label kanban',
    'Media and play': 'image camera movie video music headphone speaker gamepad chess dice play playlist heart trophy',
    'Technology': 'code terminal server device-laptop device-phone monitor keyboard mouse git-branch github shield lock bug power',
    'Everyday': 'map gps coffee shopping-bag cart wallet building sun moon lightbulb user users',
}
# Version 1.8.1 uses these actual free-set names instead of generic synonyms.
ALIASES = {'globe': 'world', 'rss': 'radio-signal', 'terminal': 'script'}
ROOT = Path(__file__).resolve().parents[1]
archive = Path(sys.argv[1])
data = archive.read_bytes()
if base64.b64encode(hashlib.sha512(data).digest()).decode() != INTEGRITY:
    raise SystemExit('Refusing unpinned Pixelarticons bytes')
icons, provenance = {}, {}
def member(tar, path):
    file = tar.extractfile(path)
    assert file is not None
    return file.read()

with tarfile.open(archive) as tar:
    package = json.loads(member(tar, 'package/package.json'))
    assert package['version'] == '1.8.1'
    license_bytes = member(tar, 'package/LICENSE')
    assert b'Copyright (c) 2019 Gerrit Halfmann' in license_bytes and b'MIT License' in license_bytes
    for group, names in GROUPS.items():
        for name in names.split():
            name = ALIASES.get(name, name)
            path = 'package/svg/' + name + '.svg'
            # Some generic names are absent: do not invent icons or counts.
            try:
                raw = member(tar, path)
            except KeyError:
                print('Not in this free input; omitted:', name)
                continue
            assert b'<!' not in raw
            svg = ET.fromstring(raw)
            assert svg.tag == '{http://www.w3.org/2000/svg}svg'
            assert set(svg.attrib) <= {'viewBox', 'fill'} and svg.attrib['viewBox'] == '0 0 24 24'
            paths = []
            for child in svg:
                assert child.tag == '{http://www.w3.org/2000/svg}path'
                assert set(child.attrib) <= {'d', 'fill', 'fill-rule', 'clip-rule'}, (path, child.attrib)
                assert child.attrib.get('fill', svg.attrib.get('fill')) == 'currentColor', (path, svg.attrib, child.attrib)
                # Preserve only ordinary geometric paths; no executable markup.
                assert re.fullmatch(r'[MmZzLlHhVvCcSsQqTtAaEe0-9.,+\s-]+', child.attrib['d'])
                assert 'fill-rule' not in child.attrib and 'clip-rule' not in child.attrib
                paths.append(child.attrib['d'])
            assert paths
            id = 'pixel-' + name
            icons[id] = dict(label=name.replace('-', ' '), group=group, paths=paths)
            compact = json.dumps(paths, separators=(',', ':'), ensure_ascii=False)
            provenance[id] = dict(sourcePath=path, svgSha256=hashlib.sha256(raw).hexdigest(), pathDataSha256=hashlib.sha256(compact.encode()).hexdigest())
(ROOT / 'server/pixel-icons.mjs').write_text('// Generated audited free path data; rebuild with tools/bundle-pixel-icons.py.\nexport const pixelIcons=Object.freeze(Object.assign(Object.create(null),' + json.dumps(icons, separators=(',', ':')) + '));\n')
licenses = ROOT / 'public/licenses'
(licenses / 'pixelarticons-MIT.txt').write_bytes(license_bytes)
(licenses / 'pixelarticons-sources.json').write_text(json.dumps(dict(package='pixelarticons', version='1.8.1', repository='https://github.com/halfmage/pixelarticons', tarball='https://registry.npmjs.org/pixelarticons/-/pixelarticons-1.8.1.tgz', integrity='sha512-' + INTEGRITY, tarballSha256=hashlib.sha256(data).hexdigest(), licenseSha256=hashlib.sha256(license_bytes).hexdigest(), iconCount=len(icons), choice='Bounded grouped free-set subset; legacy icons retained for stored layouts. No paid Pro assets.', icons=provenance), indent=2) + '\n')
print('Audited and generated', len(icons), 'free icons;', (ROOT / 'server/pixel-icons.mjs').stat().st_size, 'source bytes')
