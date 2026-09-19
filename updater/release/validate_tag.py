import json
from pathlib import Path
import sys

from updater.broker.auth import Denied, VERSION


def validate(tag, root=Path('.')):
    if not isinstance(tag, str) or not VERSION.fullmatch(tag):
        raise Denied('Only exact stable tags may publish')
    package = json.loads((root / 'package.json').read_text())
    lock = json.loads((root / 'package-lock.json').read_text())
    if any('v' + version != tag for version in (package['version'], lock['version'], lock['packages']['']['version'])):
        raise Denied('Tag/package/lock version mismatch')


if __name__ == '__main__':
    validate(sys.argv[1])
