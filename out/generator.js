"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.generateCode = generateCode;
exports.generatePortClassFiles = generatePortClassFiles;
function generateCode(element, className, headerIndent = '  ', sourceIndent = '  ') {
    switch (element.kind) {
        case 'Signal': return generateSignal(element, headerIndent, sourceIndent);
        case 'Parameter': return generateParameter(element, headerIndent, sourceIndent);
        case 'Alarm': return generateAlarm(element, headerIndent, sourceIndent);
        case 'Property': return generateProperty(element, headerIndent, sourceIndent);
        case 'Connector': return generateConnector(element, headerIndent, sourceIndent);
        case 'State': return generateState(element, className, headerIndent, sourceIndent);
        case 'StateTransition': return generateStateTransition(element, className, headerIndent, sourceIndent);
        case 'Message': return generateMessage(element, className, headerIndent, sourceIndent);
        case 'Port': return generatePort(element, headerIndent, sourceIndent);
        default: throw new Error(`Unknown element kind: ${element.kind}`);
    }
}
function generateSignal(el, hi, si) {
    const t = el.type || 'double';
    return {
        headerDecl: `${hi}CDPSignal<${t}> ${el.codeName};`,
        createCall: `${si}${el.codeName}.Create("${el.xmlName}", this);`,
        createModelCall: '',
        functionBodies: '',
        include: '<Signal/CDPSignal.h>',
    };
}
function generateParameter(el, hi, si) {
    return {
        headerDecl: `${hi}CDPParameter ${el.codeName};`,
        createCall: `${si}${el.codeName}.Create("${el.xmlName}", this);`,
        createModelCall: '',
        functionBodies: '',
        include: '<CDPParameter/CDPParameter.h>',
    };
}
function generateAlarm(el, hi, si) {
    return {
        headerDecl: `${hi}CDPAlarm ${el.codeName};`,
        createCall: `${si}${el.codeName}.Create("${el.xmlName}", this);`,
        createModelCall: '',
        functionBodies: '',
        include: '<CDPAlarm/CDPAlarm.h>',
    };
}
function generateProperty(el, hi, si) {
    const t = el.type || 'double';
    return {
        headerDecl: `${hi}CDPProperty<${t}> ${el.codeName};`,
        createCall: `${si}${el.codeName}.Create("${el.xmlName}", this, CDPPropertyBase::e_Element);`,
        createModelCall: '',
        functionBodies: '',
        include: '<CDPSystem/Base/CDPProperty.h>',
    };
}
function generateConnector(el, hi, si) {
    return {
        headerDecl: `${hi}CDPConnector ${el.codeName};`,
        createCall: `${si}${el.codeName}.Create("${el.xmlName}", this);`,
        createModelCall: '',
        functionBodies: '',
        include: '<CDPSystem/Base/CDPConnector.h>',
    };
}
function generateState(el, className, hi, si) {
    const desc = el.description || '';
    return {
        headerDecl: `${hi}void Process${el.codeName}();`,
        createCall: '',
        createModelCall: `${si}RegisterStateProcess("${el.xmlName}", (CDPCOMPONENT_STATEPROCESS)&${className}::Process${el.codeName}${desc ? `, "${desc}"` : ''});`,
        functionBodies: `\nvoid ${className}::Process${el.codeName}()\n{\n}\n`,
    };
}
function generateStateTransition(el, className, hi, si) {
    const from = el.fromState;
    const to = el.toState;
    const desc = el.description || '';
    return {
        headerDecl: `${hi}bool Transition${from}To${to}();`,
        createCall: '',
        createModelCall: `${si}RegisterStateTransitionHandler("${from}", "${to}", (CDPCOMPONENT_STATETRANSITIONHANDLER)&${className}::Transition${from}To${to}${desc ? `, "${desc}"` : ', ""'});`,
        functionBodies: `\nbool ${className}::Transition${from}To${to}()\n{\n${si}return requestedState=="${to}";\n}\n`,
    };
}
function generateMessage(el, className, hi, si) {
    const desc = el.description || '';
    return {
        headerDecl: `${hi}int Message${el.codeName}(void* message);`,
        createCall: '',
        createModelCall: `${si}RegisterMessage(CM_TEXTCOMMAND, "${el.xmlName}", "${desc}", (CDPOBJECT_MESSAGEHANDLER)&${className}::Message${el.codeName});`,
        functionBodies: `\nint ${className}::Message${el.codeName}(void* /*message*/)\n{\n${si}return 1;\n}\n`,
    };
}
function generatePort(el, hi, si) {
    return {
        headerDecl: `${hi}${el.codeName}Port ${el.codeName.toLowerCase()};`,
        createCall: `${si}${el.codeName.toLowerCase()}.Create("${el.xmlName}", this);`,
        createModelCall: '',
        functionBodies: '',
    };
}
function generatePortClassFiles(portName) {
    const guardName = `${portName.toUpperCase()}_H`;
    const headerContent = `#ifndef ${guardName}
#define ${guardName}

#include <CDPSystem/Base/CDPPort.h>
#include <CDPSystem/Base/CDPProperty.h>

class ${portName}Port : public CDPPort
{
public:
    void Create(const char* shortName, CDPComponent* parent) override;
};

#endif // ${guardName}
`;
    const sourceContent = `#include "${portName}Port.h"

void ${portName}Port::Create(const char* shortName, CDPComponent* parent)
{
    CDPPort::Create(shortName, parent);
}
`;
    return { headerContent, sourceContent };
}
//# sourceMappingURL=generator.js.map