import { parse as parseYaml, stringify as stringifyYaml } from 'yaml';

const DELIMITER = '---';
const DELIMITER_RE = /^---\s*$/m;

export function parse(fileContent) {
  const lines = fileContent.split('\n');
  if (lines[0].trim() !== DELIMITER) {
    return { meta: {}, body: fileContent };
  }
  let endIdx = -1;
  for (let i = 1; i < lines.length; i++) {
    if (DELIMITER_RE.test(lines[i])) {
      endIdx = i;
      break;
    }
  }
  if (endIdx === -1) {
    return { meta: {}, body: fileContent };
  }
  const yamlBlock = lines.slice(1, endIdx).join('\n');
  const body = lines.slice(endIdx + 1).join('\n');
  const meta = parseYaml(yamlBlock) || {};
  return { meta, body };
}

export function serialize(meta, body = '') {
  const yamlStr = stringifyYaml(meta, { lineWidth: 0 }).trimEnd();
  return `${DELIMITER}\n${yamlStr}\n${DELIMITER}\n${body}`;
}
