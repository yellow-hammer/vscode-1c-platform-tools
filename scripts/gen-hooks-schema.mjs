// Генерирует список разрешённых command id в resources/schemas/hooks.schema.json
// из объявленных команд расширения (package.json) с той же политикой, что решает,
// какие команды видит агент: интерактивные мастера и навигация в подсказки не идут.
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
const PACKAGE = join(root, 'package.json');
const POLICY = join(root, 'src', 'shared', 'mcpCommandPolicy.ts');
const SCHEMA = join(root, 'resources', 'schemas', 'hooks.schema.json');
const COMMAND_PREFIX = '1c-platform-tools.';

/** Читает список идентификаторов из mcpCommandPolicy.ts */
function readPolicyList(source, name) {
	const block = new RegExp(name + ' = \\[(.*?)\\];', 's').exec(source);
	if (!block) {
		throw new Error(`Не найден список ${name} в ${POLICY}`);
	}
	const items = [...block[1].matchAll(/`\$\{COMMAND_PREFIX\}([^`]*)`/g)];
	return items.map((match) => COMMAND_PREFIX + match[1]);
}

/**
 * Команды расширения, на которые имеет смысл вешать хуки: те же, что видит
 * агент. Интерактивные мастера, навигация и служебные команды не попадают.
 */
function collectCommandIds() {
	const pkg = JSON.parse(readFileSync(PACKAGE, 'utf8'));
	const policy = readFileSync(POLICY, 'utf8');
	const hiddenPrefixes = readPolicyList(policy, 'HIDDEN_PREFIXES');
	const hiddenExact = new Set(readPolicyList(policy, 'HIDDEN_EXACT'));

	const ids = pkg.contributes.commands
		.map((command) => command.command)
		.filter(
			(id) =>
				id.startsWith(COMMAND_PREFIX) &&
				!hiddenExact.has(id) &&
				!hiddenPrefixes.some((prefix) => id.startsWith(prefix))
		);
	if (ids.length === 0) {
		throw new Error(`Не найдено ни одной команды в ${PACKAGE}`);
	}
	return [...new Set(ids)].sort();
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
