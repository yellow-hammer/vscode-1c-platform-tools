// Генерирует список разрешённых command id в resources/schemas/hooks.schema.json
// из единственного источника правды — id-литералов в src/features/tools/commandNames.ts.
//
// Использование:
//   node scripts/gen-hooks-schema.mjs          — перезаписать схему актуальным списком
//   node scripts/gen-hooks-schema.mjs --check   — проверить, что схема не устарела (exit 1 если устарела)
//
// Запускается в vscode:prepublish (перед упаковкой) и в pretest (CI-проверка).

import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const COMMAND_NAMES = join(root, 'src', 'features', 'tools', 'commandNames.ts');
const SCHEMA = join(root, 'resources', 'schemas', 'hooks.schema.json');

/** Извлекает уникальные id-литералы `1c-platform-tools.*` из commandNames.ts */
function collectCommandIds() {
	const source = readFileSync(COMMAND_NAMES, 'utf8');
	const ids = new Set();
	for (const match of source.matchAll(/\bid:\s*'(1c-platform-tools\.[^']+)'/g)) {
		ids.add(match[1]);
	}
	if (ids.size === 0) {
		throw new Error(`Не найдено ни одного command id в ${COMMAND_NAMES}`);
	}
	return [...ids].sort();
}

/** Возвращает текст схемы со строгим enum допустимых ключей хуков */
function buildSchemaText(ids) {
	const schema = JSON.parse(readFileSync(SCHEMA, 'utf8'));
	// "*" — wildcard на все команды, далее точные command id.
	schema.properties.hooks.propertyNames = { enum: ['*', ...ids] };
	return `${JSON.stringify(schema, null, 2)}\n`;
}

const isCheck = process.argv.includes('--check');
const ids = collectCommandIds();
const next = buildSchemaText(ids);
const current = readFileSync(SCHEMA, 'utf8');

if (isCheck) {
	if (current !== next) {
		console.error(
			'hooks.schema.json устарел: список command id не совпадает с commandNames.ts.\n' +
				'Запустите `npm run gen:hooks-schema` и закоммитьте результат.'
		);
		process.exit(1);
	}
	console.log(`hooks.schema.json актуален (${ids.length} command id).`);
} else if (current === next) {
	console.log(`hooks.schema.json без изменений (${ids.length} command id).`);
} else {
	writeFileSync(SCHEMA, next, 'utf8');
	console.log(`hooks.schema.json обновлён: ${ids.length} command id.`);
}
