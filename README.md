# cdp-codegen — VS Code Extension for CDP Element Management

A VS Code extension (and standalone CLI) for adding, removing, and renaming CDP elements in C++ component files. Keeps `.h`, `.cpp`, and XML template in sync automatically.

## What it does

CDP components consist of three files that must always stay in sync:

| File | Purpose |
|------|---------|
| `ComponentName.h` | Member variable declaration |
| `ComponentName.cpp` | `Create()` call |
| `Templates/Models/LibName.ComponentName.xml` | CDP Studio model element tag |

This tool updates all three in one operation.

Supported element types: **Signal**, **Parameter**, **Alarm**, **Property**, **Connector**, **State**, **StateTransition**, **Message**, **Port**.

---

## Installation

Requires Node.js 20+ (via [nvm](https://github.com/nvm-sh/nvm) recommended).

```bash
export NVM_DIR="$HOME/.nvm" && \. "$NVM_DIR/nvm.sh" && nvm use 20
cd /path/to/VSCodeCDPSignalGenerator
sh install.sh
```

This will:
1. Compile the extension TypeScript
2. Compile the CLI (`cli/`)
3. Package into a `.vsix`
4. Install into VS Code

---

## Using the VS Code extension

1. Open any `.cpp` or `.h` file belonging to a CDP component
2. Open the Command Palette (`Ctrl+Shift+P`)
3. Type `CDP` — available commands:
   - `CDP: Add Signal / Parameter / Alarm / Property / ...`
   - `CDP: Remove Element`
   - `CDP: Change Element`
4. Follow the prompts — the extension updates all three files automatically

---

## Using the CLI directly

The CLI lives in `cli/dist/main.js` and can be called independently of VS Code — useful for scripting or Copilot skill automation.

```bash
export NVM_DIR="$HOME/.nvm" && \. "$NVM_DIR/nvm.sh" && nvm use 20
node cli/dist/main.js --help
```

Key commands:
```
node cli/dist/main.js add <kind> <file> <name> [options]
node cli/dist/main.js remove <file> <name> [--kind K]
node cli/dist/main.js change <file> <oldName> <newName> [--kind K]
node cli/dist/main.js parse <file>
```

Run `--help` for the full option reference and examples.

---

## Architecture

```
VSCodeCDPSignalGenerator/
├── cli/                   # Standalone Node.js CLI (no VS Code dependency)
│   └── src/
│       ├── main.ts        # CLI entry point
│       ├── parser.ts      # Parses .h/.cpp to find class info
│       ├── inserter.ts    # Applies add/remove/change to all three files
│       ├── xmlEditor.ts   # Reads/writes XML template files
│       ├── generator.ts   # Generates C++ code snippets
│       └── types.ts       # Shared type definitions
└── src/                   # VS Code extension (thin wrapper around CLI)
    ├── extension.ts       # Activation, command registration
    ├── ui.ts              # Input prompts and QuickPick dialogs
    ├── runner.ts          # Spawns CLI via child_process
    ├── parser.ts          # Wrapper: calls CLI parse action
    └── inserter.ts        # Wrapper: calls CLI add/remove/change
```

The extension UI collects user input, then delegates all file operations to the CLI. This means the CLI and the Copilot skill (in `C30Git/.github/skills/cdp-element/`) share the same engine.

---

## Development

```bash
# Compile everything
npm run compile
cd cli && npm run compile

# Repackage and reinstall
sh install.sh
```

After making changes to the CLI, always re-run `install.sh` to update the installed extension.

---

## Using the CLI as a GitHub Copilot skill

The CLI can also be called by GitHub Copilot (via a skill) so you can ask Copilot in chat to add/remove/rename CDP elements without going through the VS Code Command Palette.

### Setup

The skill definition lives in your C++ component repository under `.github/skills/cdp-element/SKILL.md`. It tells Copilot to call this CLI.

**Prerequisite:** The CLI must be compiled (`cli/dist/main.js` must exist). Run `sh install.sh` once, or just `cd cli && npm run compile`.

### Usage

With the skill installed, you can ask Copilot things like:

> *"add a bool input signal called i_Enable to HoistControl"*
> *"remove the signal SpeedIn from InputShaper"*
> *"rename signal OldName to NewName in CraneCtrl"*

Copilot will run the CLI in a terminal and update all three files (`.h`, `.cpp`, XML template) automatically.

### Pointing the skill to this CLI

The skill file references the absolute path to `cli/dist/main.js`. If you move this repository, update the path in `.github/skills/cdp-element/SKILL.md` in your component repository.

