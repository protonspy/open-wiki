# Opening an existing project — tasks

## 1 · What a project can be made in

- [x] 1.1 (Unit) Accept a git repository in the scaffolder's guard, renaming the predicate for what it now decides — R1.1, R1.2, R1.3
- [x] 1.2 (Unit) Keep an entry file this product did not write, classified through the one classifier `ow update` already uses, and name what was kept — R1.4

## 2 · Adopting a project that already exists

- [x] 2.1 (TDD) Derive a registry name from a directory, suffixing one another directory already holds — R2.3 - RED observed: all six assertions failed on `deriveProjectName is not a function` before the implementation existed.
- [x] 2.2 (Unit) Adopt a directory: refuse a non-project, answer with the name already registered for it, otherwise register the derived one — R2.2, R2.3, R2.5

## 3 · The two channels

- [x] 3.1 (Unit) Carry the system's directory chooser into the API, answering null when it is cancelled — R3.1, R3.3
- [x] 3.2 (Unit) Answer a chosen directory with the project it opened, or with `not-a-project` and the directory — R2.2, R2.4

## 4 · The launcher

- [x] 4.1 (Unit) Offer **Open project…** beside **New project**, carrying a directory that is not a project into the create form — R2.1, R2.4
- [x] 4.2 (Unit) Put **Choose…** beside the directory field, leaving what is typed there alone when the chooser is cancelled — R3.1, R3.2, R3.3
- [x] 4.3 (Unit) Offer opening an existing project on the first run too, which an empty registry is the whole of — R2.1

## 5 · Where a new project goes by default

- [x] 5.1 (Unit) Answer where new projects go by default, derived from the user's home directory and owning nothing — R3.4
- [x] 5.2 (Unit) Derive `<default>/<name>` while the directory field is untouched, and stop deriving once it is — R3.4, R3.5
- [x] 5.3 (Unit) Use the proposal on both doors — the launcher's create form and the first run — R3.4, R3.5
