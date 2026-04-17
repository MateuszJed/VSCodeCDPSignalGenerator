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
exports.promptForNewElement = promptForNewElement;
exports.promptSelectElement = promptSelectElement;
exports.promptForChange = promptForChange;
const vscode = __importStar(require("vscode"));
const types_1 = require("./types");
const ALARM_LEVELS = ['Error', 'Warning', 'Notify'];
/**
 * Prompt user for element details when adding.
 * Shows a full form with: Code Name, XML Name, Datatype, Unit, Description, Value, Input/Output
 */
async function promptForNewElement(kind, parsed) {
    if (kind === 'StateTransition') {
        return promptForStateTransition(parsed);
    }
    // --- Code Name ---
    const codeName = await vscode.window.showInputBox({
        prompt: `[${kind}] Code name (C++ member variable)`,
        placeHolder: kind === 'Signal' ? 'e.g. i_SpeedIn or o_SpeedOut' : kind === 'Parameter' ? 'e.g. p_MaxSpeed' : kind === 'Alarm' ? 'e.g. a_OverSpeed' : `e.g. my${kind}`,
        validateInput: (v) => /^\w+$/.test(v) ? null : 'Must be alphanumeric/underscore',
    });
    if (!codeName) {
        return undefined;
    }
    // --- XML Name ---
    // Default: strip common prefixes (i_, o_, p_, a_) for XML name
    const defaultXmlName = codeName.replace(/^[iopa]_/, '');
    const xmlName = await vscode.window.showInputBox({
        prompt: `[${kind}] XML name (used in template XML)`,
        value: defaultXmlName,
        validateInput: (v) => v.length > 0 ? null : 'XML name cannot be empty',
    });
    if (!xmlName) {
        return undefined;
    }
    // --- Datatype (Signal, Property) ---
    let type;
    if (kind === 'Signal' || kind === 'Property') {
        const picked = await vscode.window.showQuickPick(types_1.CDP_TYPES.map(t => ({ label: t })), { placeHolder: `[${kind}] Select data type` });
        if (!picked) {
            return undefined;
        }
        type = picked.label;
    }
    // --- Input/Output (Signal) ---
    let input;
    if (kind === 'Signal') {
        const io = await vscode.window.showQuickPick([{ label: 'Input', description: 'Receives value via routing' }, { label: 'Output', description: 'Provides value to other components' }], { placeHolder: `[${kind}] Input or Output?` });
        if (!io) {
            return undefined;
        }
        input = io.label === 'Input';
    }
    // --- Unit ---
    let unit;
    if (['Signal', 'Parameter', 'Alarm'].includes(kind)) {
        unit = await vscode.window.showInputBox({
            prompt: `[${kind}] Unit (optional)`,
            placeHolder: 'e.g. m/s, rad, 0/1, bar, rpm',
        }) || undefined;
    }
    // --- Description ---
    const description = await vscode.window.showInputBox({
        prompt: `[${kind}] Description (for XML)`,
        placeHolder: 'Brief description of this element',
    }) || undefined;
    // --- Value ---
    let value;
    if (['Signal', 'Parameter', 'Property'].includes(kind)) {
        value = await vscode.window.showInputBox({
            prompt: `[${kind}] Initial value (optional)`,
            placeHolder: 'e.g. 0, 1.5, true, ""',
        }) || undefined;
    }
    // --- Alarm-specific ---
    let level;
    let text;
    let min;
    let max;
    if (kind === 'Alarm') {
        const lvl = await vscode.window.showQuickPick(ALARM_LEVELS.map(l => ({ label: l })), { placeHolder: '[Alarm] Level' });
        level = lvl?.label;
        text = await vscode.window.showInputBox({
            prompt: '[Alarm] Alarm text (displayed when active)',
            placeHolder: 'e.g. Motor overheated!',
        }) || undefined;
    }
    // --- Parameter min/max ---
    if (kind === 'Parameter') {
        min = await vscode.window.showInputBox({ prompt: '[Parameter] Min value (optional)' }) || undefined;
        max = await vscode.window.showInputBox({ prompt: '[Parameter] Max value (optional)' }) || undefined;
    }
    return { kind, codeName, xmlName, type, input, unit, description, value, level, text, min, max };
}
async function promptForStateTransition(parsed) {
    const existingStates = parsed.elements.filter(e => e.kind === 'State').map(e => e.xmlName);
    let fromState;
    let toState;
    if (existingStates.length > 0) {
        const from = await vscode.window.showQuickPick([...existingStates.map(s => ({ label: s })), { label: '$(add) Enter custom...', description: 'Type a new state name' }], { placeHolder: 'From state' });
        if (!from) {
            return undefined;
        }
        fromState = from.label.startsWith('$(add)') ? await vscode.window.showInputBox({ prompt: 'From state name' }) : from.label;
        const to = await vscode.window.showQuickPick([...existingStates.map(s => ({ label: s })), { label: '$(add) Enter custom...', description: 'Type a new state name' }], { placeHolder: 'To state' });
        if (!to) {
            return undefined;
        }
        toState = to.label.startsWith('$(add)') ? await vscode.window.showInputBox({ prompt: 'To state name' }) : to.label;
    }
    else {
        fromState = await vscode.window.showInputBox({ prompt: 'From state name' });
        toState = fromState ? await vscode.window.showInputBox({ prompt: 'To state name' }) : undefined;
    }
    if (!fromState || !toState) {
        return undefined;
    }
    const description = await vscode.window.showInputBox({ prompt: 'Description (optional)' });
    return {
        kind: 'StateTransition',
        codeName: `${fromState}To${toState}`,
        xmlName: `${fromState}To${toState}`,
        fromState,
        toState,
        description: description || undefined,
    };
}
/**
 * Prompt user to select an existing element (for remove/change).
 */
async function promptSelectElement(parsed, action) {
    if (parsed.elements.length === 0) {
        vscode.window.showInformationMessage('No CDP elements found in this class.');
        return undefined;
    }
    const items = parsed.elements.map(e => ({
        label: formatElementLabel(e),
        description: e.kind,
        detail: e.codeName !== e.xmlName ? `Code: ${e.codeName} | XML: ${e.xmlName}` : undefined,
        element: e,
    }));
    const picked = await vscode.window.showQuickPick(items, {
        placeHolder: `Select element to ${action}`,
    });
    return picked?.element;
}
/**
 * Prompt for new values when changing an element.
 */
async function promptForChange(oldElement) {
    if (oldElement.kind === 'StateTransition') {
        const fromState = await vscode.window.showInputBox({ prompt: 'New from state', value: oldElement.fromState });
        if (!fromState) {
            return undefined;
        }
        const toState = await vscode.window.showInputBox({ prompt: 'New to state', value: oldElement.toState });
        if (!toState) {
            return undefined;
        }
        return { ...oldElement, fromState, toState, codeName: `${fromState}To${toState}`, xmlName: `${fromState}To${toState}` };
    }
    const newCodeName = await vscode.window.showInputBox({
        prompt: `New code name for ${oldElement.kind}`,
        value: oldElement.codeName,
        validateInput: (v) => /^\w+$/.test(v) ? null : 'Must be alphanumeric/underscore',
    });
    if (!newCodeName) {
        return undefined;
    }
    const newXmlName = await vscode.window.showInputBox({
        prompt: `New XML name for ${oldElement.kind}`,
        value: oldElement.xmlName,
    });
    if (!newXmlName) {
        return undefined;
    }
    let newType = oldElement.type;
    if (oldElement.kind === 'Signal' || oldElement.kind === 'Property') {
        const picked = await vscode.window.showQuickPick(types_1.CDP_TYPES.map(t => ({ label: t, picked: t === oldElement.type })), { placeHolder: `Select type (current: ${oldElement.type})` });
        if (picked) {
            newType = picked.label;
        }
    }
    return { ...oldElement, codeName: newCodeName, xmlName: newXmlName, type: newType };
}
function formatElementLabel(e) {
    switch (e.kind) {
        case 'Signal': return `${e.codeName} : CDPSignal<${e.type}>`;
        case 'Property': return `${e.codeName} : CDPProperty<${e.type}>`;
        case 'StateTransition': return `${e.fromState} → ${e.toState}`;
        default: return e.codeName;
    }
}
//# sourceMappingURL=ui.js.map