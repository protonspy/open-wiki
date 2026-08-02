# Source status — tasks

## 1 · The field

- [x] 1.1 (TDD) Read `processed` out of `manifest.json`: absent is unprocessed, a value that is not a date degrades to unprocessed rather than refusing the manifest — R1.1, R1.2, R1.3, R1.4

## 2 · The one writer

- [x] 2.1 (TDD) `updateManifest` in `@open-wiki/access`: declare or withdraw `processed`, correct a title, leave every other field alone, write atomically, and refuse an id that names no source — R2.1, R2.2, R2.3, R2.4
- [x] 2.2 (Unit) The desktop's `retitleSource` becomes a call into it, so there is one manifest mutator and not two — R2.1
- [x] 2.3 (Unit) Writing `text.md` for a source already declared processed withdraws the declaration — R3.1

## 3 · What reads it

- [x] 3.1 (Unit) `sourceState` and `listSourceStates` carry the declaration beside the derived stage — R1.1, R1.2
- [x] 3.2 (Unit) `source.uncited` reports only what is neither declared processed nor cited, and its `fix` names both ways out — R4.1, R4.2
