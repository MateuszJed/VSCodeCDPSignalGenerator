# Refactor Proposal: CDP Element CLI + Extension Wrapper

## Goal

Move all CDP element file-editing logic into one standalone Node.js CLI tool: `cdp-element`.

The VS Code extension shall only handle manual UI work such as quick-picks, input boxes, and user interaction.
The VS Code Chat / Copilot skill shall call the same CLI directly.

This gives one shared implementation for both workflows:

- Manual use through the VS Code command palette / UI.
- Automated use through VS Code Chat / Copilot skill.

No duplicate logic. No separate Python implementation. No separate skill-specific engine.

---

## Main Idea

Today, the VS Code extension contains both UI logic and file-editing logic.
The target design separates them completely:

```
User via VS Code UI
        │
        ▼
VS Code Extension  (UI only: quick-picks, input boxes)
        │
        ▼
cdp-element CLI
        │
        ▼
Modify .h / .cpp / .xml files


User via VS Code Chat / Copilot Skill
        │
        ▼
cdp-element CLI
        │
        ▼
Modify .h / .cpp / .xml files
```

The CLI becomes the only place where CDP element logic exists.
The extension and the Copilot skill both become thin wrappers around it.

---

## Current Problem

The following source files depend directly on the VS Code API:

```
src/parser.ts
src/inserter.ts
src/xmlEditor.ts
```

They use:

```ts
vscode.WorkspaceEdit
vscode.workspace.openTextDocument
doc.save()
```

Because of this coupling, the logic cannot be reused outside VS Code.
A Copilot skill therefore needs its own separate implementation — today that is
the Python script `cdp_element.py`. This creates duplicated logic and a higher
maintenance cost whenever the element format or file conventions change.

---

## Proposed Architecture

```
VSCodeCDPSignalGenerator/
├── cli/                         ← standalone Node.js CLI package
│   ├── package.json
│   ├── tsconfig.json
│   └── src/
│       ├── main.ts              ← CLI entry point (argument parsing + dispatch)
│       ├── parser.ts            ← ported: uses fs.readFileSync, no vscode
│       ├── inserter.ts          ← ported: uses fs.writeFileSync, no vscode
│       ├── generator.ts         ← unchanged (already pure logic)
│       ├── xmlEditor.ts         ← ported: uses fs read/write, no vscode
│       └── types.ts             ← unchanged (shared types)
│
├── src/                         ← VS Code extension (UI only)
│   ├── extension.ts             ← unchanged (already thin)
│   ├── ui.ts                    ← unchanged (all prompts stay here)
│   ├── runner.ts                ← new: spawns the CLI with collected args
│   ├── parser.ts                ← replaced: thin wrapper, calls CLI parse action
│   ├── inserter.ts              ← replaced: builds CLI args, calls runner
│   └── types.ts                 ← kept (shared with CLI or re-exported)
│
└── .github/skills/cdp-element/
    └── scripts/
        └── cdp_element.py       ← deleted once CLI is in place
```

---

## Responsibilities

### CLI: `cdp-element`

The CLI owns all real logic:

- Parse C++ component files (`.h` / `.cpp`).
- Add, remove, and rename all CDP element types.
- Edit `.h`, `.cpp`, and the XML model template in sync.
- Print parsed class info as JSON for use by the extension.

The CLI must not import `vscode`. It should only use Node.js builtins:

```ts
fs.readFileSync / fs.writeFileSync
path
process.argv
child_process  // not needed inside CLI, only in the extension runner
```

### VS Code Extension

The extension only owns manual UI work:

- Command registration.
- Quick-pick menus and input boxes.
- Showing success / error messages.
- Calling the CLI with the options collected from the user.

It should not contain any CDP file-editing logic of its own.

### VS Code Chat / Copilot Skill

The skill should not have its own separate implementation.
It calls the same CLI directly and becomes a thin automation layer.

---

## CLI Interface

```bash
node cli/dist/main.js <action> <kind> <source_file> [options]
```

Example:

```bash
node cli/dist/main.js add signal HoistControl.cpp i_TestSignal --type bool --input
```

### Actions

| Action       | Arguments                      | Description                              |
|--------------|--------------------------------|------------------------------------------|
| `add <kind>` | `<file> <codeName> [options]`  | Add element to `.h`, `.cpp`, and `.xml`  |
| `remove`     | `<file> <codeName> [--kind K]` | Remove element                           |
| `change`     | `<file> <oldName> <newName>`   | Rename element                           |
| `parse`      | `<file>`                       | Print parsed class info as JSON          |

### Element kinds

`signal` `parameter` `alarm` `property` `connector` `state` `statetransition` `message` `port`

### Options (add)

```
--type      double|bool|int|float|...   (Signal, Property)
--input / --output                      (Signal; defaults to input)
--xml-name  NAME                        (defaults: codeName with i_/o_/p_/a_ stripped)
--unit      UNIT
--desc      TEXT
--value     VALUE
--min / --max  VALUE                    (Parameter)
--level     Error|Warning|Notify        (Alarm)
--text      TEXT                        (Alarm)
--from      STATE                       (StateTransition)
--to        STATE                       (StateTransition)
```

### Expected output

On success:
```
Added Signal: i_TestSignal (XML: TestSignal)
```

On `parse`:
```json
{
  "className": "HoistControl",
  "headerPath": "HoistControl.h",
  "sourcePath": "HoistControl.cpp",
  "xmlPath": "Templates/Models/SeaonicsLib.HoistControl.xml",
  "elements": [
    { "kind": "Signal", "codeName": "i_SpeedIn", "xmlName": "SpeedIn", "type": "double" }
  ]
}
```

On error:
```
Error: Could not find CDPComponent class in HoistControl.h
```

Exit codes: `0` = success, non-zero = error.

---

## Proposed Implementation Order

When this refactor is carried out, the suggested order is:

1. Create `cli/` package with `package.json` and `tsconfig.json`.
2. Copy `generator.ts` and `types.ts` unchanged into `cli/src/`.
3. Port `parser.ts` — remove `vscode`, replace document API with `fs.readFileSync`.
4. Port `xmlEditor.ts` — remove `vscode`, replace edits with `fs` read/write.
5. Port `inserter.ts` — remove `vscode.WorkspaceEdit`, use direct string manipulation and `fs.writeFileSync`.
6. Write `cli/src/main.ts` — argument parsing, dispatch to parser/inserter, exit codes.
7. Build and test CLI standalone.
8. Write `src/runner.ts` in the extension — `runCli(args): Promise<string>` using `child_process.spawn`.
9. Replace `src/parser.ts` with a thin wrapper that calls `node cli/dist/main.js parse <file>` and deserializes the JSON.
10. Replace `src/inserter.ts` with thin wrappers that build CLI args and call `runCli()`.
11. Rebuild extension and test through the VS Code command palette.
12. Update the Copilot skill to call the CLI instead of the Python script.
13. Delete `cdp_element.py`.

---

## Appendix: Proposed Changes Per File

This section describes the intended change to each file when the refactor is implemented.

### `cli/src/parser.ts`
- Remove all `vscode` imports.
- Replace `vscode.workspace.openTextDocument(path)` with `fs.readFileSync(path, 'utf8')`.
- Return `ParsedClass` with the same shape as today.
- Export `parseExistingElements()` so the extension can use the `parse` action for remove/change prompts.

### `cli/src/inserter.ts`
- Remove all `vscode` imports.
- Replace `vscode.WorkspaceEdit` / `applyEdit` / `doc.save()` with direct `fs.readFileSync` + string manipulation + `fs.writeFileSync`.
- The add/remove/change logic is otherwise identical to the current implementation.

### `cli/src/xmlEditor.ts`
- Remove `vscode` imports.
- Replace document-based edits with `fs.readFileSync` / string operations / `fs.writeFileSync`.
- Function signatures for `addXmlElement`, `removeXmlElement`, `changeXmlElement`, and `findXmlTemplatePath` remain identical.

### `cli/src/generator.ts`
- No changes. Already pure TypeScript with no `vscode` dependency.

### `cli/src/types.ts`
- No changes. Already pure types.

### `cli/src/main.ts` (new)
- Argument parsing using plain `process.argv` (no external dependencies).
- Calls `parseClass()` then dispatches to `addElement()` / `removeElement()` / `changeElement()`.
- Exits with code 0 on success, 1 on error.

### `src/runner.ts` (new, extension)
- Exports `runCli(args: string[]): Promise<string>`.
- Resolves CLI path relative to the installed extension directory.
- Spawns Node.js with `child_process.spawn`, captures stdout/stderr.
- Resolves on exit code 0, rejects on non-zero.

### `src/inserter.ts` (extension, replaced)
- `addElement(parsed, element)` builds CLI args from `ElementInfo` and calls `runCli()`.
- `removeElement` and `changeElement` follow the same pattern.

### `src/parser.ts` (extension, replaced)
- `parseClass(filePath)` calls `runCli(['parse', filePath])` and deserializes the JSON output into `ParsedClass`.

### Bundling
- `cli/dist/` must be included in the `.vsix` package so the extension can locate the CLI at runtime.
- Update `.vscodeignore` if needed to ensure `cli/dist/` is not excluded.
- Node.js `>=20` should be declared in `cli/package.json` under `engines`.
