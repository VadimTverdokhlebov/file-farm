"""Builds a single-file copy of index.html with all figure images inlined."""
import base64
import pathlib
import re
import sys

ROOT = pathlib.Path(__file__).parent
DEFAULT_OUT = pathlib.Path('/mnt/c/Users/user/Documents/education/Диссертация/Глава_4.html')


def inline(match: re.Match) -> str:
    path = ROOT / match.group(1)
    if not path.exists():
        return match.group(0)
    data = base64.b64encode(path.read_bytes()).decode()
    return f'data-img="data:image/png;base64,{data}" data-src="{match.group(1)}"'


def main() -> None:
    out = pathlib.Path(sys.argv[1]) if len(sys.argv) > 1 else DEFAULT_OUT
    html = (ROOT / 'index.html').read_text(encoding='utf-8')
    html = re.sub(r'data-img="([^"]+\.png)"', inline, html)
    out.write_text(html, encoding='utf-8')
    print(f'{out} ({out.stat().st_size // 1024} KB)')


if __name__ == '__main__':
    main()
