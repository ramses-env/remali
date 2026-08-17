import pathlib
src = pathlib.Path('/Users/ramses/Developer/Remali/backend/apps/maquinaria/views.py').read_text()

i = 0
N = len(src)
state = None  # None, '"""', "'''", '"', "'", '#'
line = 1
open_line = None
while i < N:
    ch = src[i]
    if ch == '\n':
        if state == '#':
            state = None
        line += 1
        i += 1
        continue
    if state is None:
        if src[i:i+3] == '"""':
            state = '"""'
            open_line = line
            i += 3
            continue
        if src[i:i+3] == "'''":
            state = "'''"
            open_line = line
            i += 3
            continue
        if ch == '"':
            state = '"'
            open_line = line
            i += 1
            continue
        if ch == "'":
            state = "'"
            open_line = line
            i += 1
            continue
        if ch == '#':
            state = '#'
            i += 1
            continue
        i += 1
    elif state in ('"""', "'''"):
        idx = src.find(state, i)
        if idx < 0:
            print(f'UNENCLOSED {state!r} opened at line {open_line}')
            break
        i = idx + 3
        state = None
    elif state == '"':
        if ch == '\\' and i+1 < N:
            i += 2
            continue
        if ch == '"':
            state = None
            i += 1
            continue
        i += 1
    elif state == "'":
        if ch == '\\' and i+1 < N:
            i += 2
            continue
        if ch == "'":
            state = None
            i += 1
            continue
        i += 1
    elif state == '#':
        i += 1
else:
    if state:
        print(f'ENDOFFILE: still in {state!r} opened at line {open_line}')
    else:
        print('All strings OK!')
