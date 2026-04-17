import { ElementInfo, CdpType } from './types';

export interface GeneratedCode {
  headerDecl: string;
  createCall: string;
  createModelCall: string;
  functionBodies: string;
  include?: string;
}

export function generateCode(element: ElementInfo, className: string, headerIndent = '  ', sourceIndent = '  '): GeneratedCode {
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

function generateSignal(el: ElementInfo, hi: string, si: string): GeneratedCode {
  const t = el.type || 'double';
  return {
    headerDecl: `${hi}CDPSignal<${t}> ${el.codeName};`,
    createCall: `${si}${el.codeName}.Create("${el.xmlName}", this);`,
    createModelCall: '',
    functionBodies: '',
    include: '<Signal/CDPSignal.h>',
  };
}

function generateParameter(el: ElementInfo, hi: string, si: string): GeneratedCode {
  return {
    headerDecl: `${hi}CDPParameter ${el.codeName};`,
    createCall: `${si}${el.codeName}.Create("${el.xmlName}", this);`,
    createModelCall: '',
    functionBodies: '',
    include: '<CDPParameter/CDPParameter.h>',
  };
}

function generateAlarm(el: ElementInfo, hi: string, si: string): GeneratedCode {
  return {
    headerDecl: `${hi}CDPAlarm ${el.codeName};`,
    createCall: `${si}${el.codeName}.Create("${el.xmlName}", this);`,
    createModelCall: '',
    functionBodies: '',
    include: '<CDPAlarm/CDPAlarm.h>',
  };
}

function generateProperty(el: ElementInfo, hi: string, si: string): GeneratedCode {
  const t = el.type || 'double';
  return {
    headerDecl: `${hi}CDPProperty<${t}> ${el.codeName};`,
    createCall: `${si}${el.codeName}.Create("${el.xmlName}", this, CDPPropertyBase::e_Element);`,
    createModelCall: '',
    functionBodies: '',
    include: '<CDPSystem/Base/CDPProperty.h>',
  };
}

function generateConnector(el: ElementInfo, hi: string, si: string): GeneratedCode {
  return {
    headerDecl: `${hi}CDPConnector ${el.codeName};`,
    createCall: `${si}${el.codeName}.Create("${el.xmlName}", this);`,
    createModelCall: '',
    functionBodies: '',
    include: '<CDPSystem/Base/CDPConnector.h>',
  };
}

function generateState(el: ElementInfo, className: string, hi: string, si: string): GeneratedCode {
  const desc = el.description || '';
  return {
    headerDecl: `${hi}void Process${el.codeName}();`,
    createCall: '',
    createModelCall: `${si}RegisterStateProcess("${el.xmlName}", (CDPCOMPONENT_STATEPROCESS)&${className}::Process${el.codeName}${desc ? `, "${desc}"` : ''});`,
    functionBodies: `\nvoid ${className}::Process${el.codeName}()\n{\n}\n`,
  };
}

function generateStateTransition(el: ElementInfo, className: string, hi: string, si: string): GeneratedCode {
  const from = el.fromState!;
  const to = el.toState!;
  const desc = el.description || '';
  return {
    headerDecl: `${hi}bool Transition${from}To${to}();`,
    createCall: '',
    createModelCall: `${si}RegisterStateTransitionHandler("${from}", "${to}", (CDPCOMPONENT_STATETRANSITIONHANDLER)&${className}::Transition${from}To${to}${desc ? `, "${desc}"` : ', ""'});`,
    functionBodies: `\nbool ${className}::Transition${from}To${to}()\n{\n${si}return requestedState=="${to}";\n}\n`,
  };
}

function generateMessage(el: ElementInfo, className: string, hi: string, si: string): GeneratedCode {
  const desc = el.description || '';
  return {
    headerDecl: `${hi}int Message${el.codeName}(void* message);`,
    createCall: '',
    createModelCall: `${si}RegisterMessage(CM_TEXTCOMMAND, "${el.xmlName}", "${desc}", (CDPOBJECT_MESSAGEHANDLER)&${className}::Message${el.codeName});`,
    functionBodies: `\nint ${className}::Message${el.codeName}(void* /*message*/)\n{\n${si}return 1;\n}\n`,
  };
}

function generatePort(el: ElementInfo, hi: string, si: string): GeneratedCode {
  return {
    headerDecl: `${hi}${el.codeName}Port ${el.codeName.toLowerCase()};`,
    createCall: `${si}${el.codeName.toLowerCase()}.Create("${el.xmlName}", this);`,
    createModelCall: '',
    functionBodies: '',
  };
}

export function generatePortClassFiles(portName: string): { headerContent: string; sourceContent: string } {
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
