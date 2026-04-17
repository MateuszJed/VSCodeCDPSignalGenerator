"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
exports.activate = activate;
exports.deactivate = deactivate;
const vscode = __importStar(require("vscode"));
const parser_1 = require("./parser");
const inserter_1 = require("./inserter");
const ui_1 = require("./ui");
function activate(context) {
    const addCommands = [
        ['cdp.addSignal', 'Signal'],
        ['cdp.addParameter', 'Parameter'],
        ['cdp.addAlarm', 'Alarm'],
        ['cdp.addProperty', 'Property'],
        ['cdp.addConnector', 'Connector'],
        ['cdp.addState', 'State'],
        ['cdp.addStateTransition', 'StateTransition'],
        ['cdp.addMessage', 'Message'],
        ['cdp.addPort', 'Port'],
    ];
    for (const [commandId, kind] of addCommands) {
        context.subscriptions.push(vscode.commands.registerCommand(commandId, async () => {
            const editor = vscode.window.activeTextEditor;
            if (!editor) {
                return;
            }
            const parsed = await (0, parser_1.parseClass)(editor.document.uri.fsPath);
            if (!parsed) {
                return;
            }
            const element = await (0, ui_1.promptForNewElement)(kind, parsed);
            if (!element) {
                return;
            }
            await (0, inserter_1.addElement)(parsed, element);
        }));
    }
    context.subscriptions.push(vscode.commands.registerCommand('cdp.remove', async () => {
        const editor = vscode.window.activeTextEditor;
        if (!editor) {
            return;
        }
        const parsed = await (0, parser_1.parseClass)(editor.document.uri.fsPath);
        if (!parsed) {
            return;
        }
        const element = await (0, ui_1.promptSelectElement)(parsed, 'remove');
        if (!element) {
            return;
        }
        await (0, inserter_1.removeElement)(parsed, element);
    }));
    context.subscriptions.push(vscode.commands.registerCommand('cdp.change', async () => {
        const editor = vscode.window.activeTextEditor;
        if (!editor) {
            return;
        }
        const parsed = await (0, parser_1.parseClass)(editor.document.uri.fsPath);
        if (!parsed) {
            return;
        }
        const oldElement = await (0, ui_1.promptSelectElement)(parsed, 'change');
        if (!oldElement) {
            return;
        }
        const newElement = await (0, ui_1.promptForChange)(oldElement);
        if (!newElement) {
            return;
        }
        await (0, inserter_1.changeElement)(parsed, oldElement, newElement);
    }));
}
function deactivate() { }
//# sourceMappingURL=extension.js.map