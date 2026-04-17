"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.CDP_TYPES = void 0;
exports.cdpTypeToXmlType = cdpTypeToXmlType;
exports.cdpTypeToSignalModel = cdpTypeToSignalModel;
exports.CDP_TYPES = ['double', 'bool', 'int', 'unsigned int', 'unsigned short', 'unsigned char', 'float', 'short', 'std::string', 'unsigned int64'];
/** Map from CdpType to XML Type attribute value */
function cdpTypeToXmlType(t) {
    if (t === 'std::string') {
        return 'string';
    }
    return t;
}
/** Map from CdpType to XML Model attribute for CDPSignal */
function cdpTypeToSignalModel(t) {
    const xmlType = t === 'std::string' ? 'string' : t;
    return `CDPSignal&lt;${xmlType}&gt;`;
}
//# sourceMappingURL=types.js.map