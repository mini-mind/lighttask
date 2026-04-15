export type ExtensionValueMap = Record<string, unknown>;

export type ExtensionNamespaceMap = Record<string, ExtensionValueMap>;

// 扩展槽拆成稳定的通用分区，避免未来所有应用字段继续挤在同一个 metadata 桶里。
export interface StructuredEntityExtensions {
  properties?: ExtensionValueMap;
  presentation?: ExtensionValueMap;
  namespaces?: ExtensionNamespaceMap;
}
