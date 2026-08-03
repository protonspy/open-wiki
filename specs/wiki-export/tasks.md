# Wiki export — tasks

## 1 · The archive

- [x] 1.1 (Unit) Adopt `yazl` in `@open-wiki/access` and record it in `docs/stack.md` with the line on why it earned its place — R1.1
- [x] 1.2 (TDD) Walk `wiki/` and `raw/`, stream each file into the zip under its project-relative path, and exclude `.state/` and `raw/_inbox/` — R1.1, R1.2, R1.3, R1.4, R1.5
- [x] 1.3 (TDD) Refuse a destination inside the project or one that already exists, and write through a temporary file and rename — R3.1, R3.2, R3.3
- [x] 1.4 (Unit) Report the file count and total bytes, and answer the same counts without writing when asked only to survey — R2.1, R2.2

## 2 · The two doors

- [x] 2.1 (Unit) `ow export [--out <path>] [--no-sources] [--survey]`, reporting what it wrote and refusing in the words the other verbs refuse in — R4.1, R4.2
- [x] 2.2 (Unit) A desktop menu item that surveys, offers the system save dialog with a default filename, and reports the result — R4.1, R4.3
