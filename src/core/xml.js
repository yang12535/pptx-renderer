const { XMLParser } = require('fast-xml-parser');

const PARSER_OPTIONS = {
  ignoreAttributes: false,
  attributeNamePrefix: '_',
  parseAttributeValue: true,
  parseTagValue: true,
  trimValues: true,
  removeNSPrefix: false, // 保留命名前缀，便于区分 p:, a:, r:
};

function parseXml(xmlString) {
  const parser = new XMLParser(PARSER_OPTIONS);
  return parser.parse(xmlString);
}

// 安全地获取对象属性，支持命名空间前缀
function get(obj, ...keys) {
  if (!obj) return undefined;
  for (const key of keys) {
    if (obj[key] !== undefined) return obj[key];
  }
  return undefined;
}

// 将可能是对象或数组的属性统一为数组
function toArray(val) {
  if (val === undefined || val === null) return [];
  return Array.isArray(val) ? val : [val];
}

// 提取子元素，处理命名空间
function child(obj, name) {
  if (!obj) return undefined;
  // 尝试直接匹配，也尝试带前缀匹配
  const val = obj[name];
  if (val !== undefined) return val;
  // 遍历所有 key 查找后缀匹配（简化处理）
  const suffix = ':' + name;
  for (const key of Object.keys(obj)) {
    if (key.endsWith(suffix)) return obj[key];
  }
  return undefined;
}

module.exports = {
  parseXml,
  get,
  toArray,
  child,
};
