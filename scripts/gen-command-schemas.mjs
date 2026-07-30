// Генерирует списки разрешённых command id в схемах служебных файлов: hooks.schema.json
// (ключи хуков) и pipelines.schema.json (команда шага). Список берётся из объявленных
// команд расширения (package.json) с той же политикой, что решает, какие команды видит
// агент: интерактивные мастера и навигация в подсказки не идут.
//
// Использование:
//   node scripts/gen-command-schemas.mjs          — перезаписать схемы актуальным списком
//   node scripts/gen-command-schemas.mjs --check   — проверить, что схемы не устарели (exit 1 если устарели)
//
// Запускается в vscode:prepublish (перед упаковкой) и в pretest (CI-проверка).

import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const PACKAGE = join(root, 'package.json');
const POLICY = join(root, 'src', 'shared', 'mcpCommandPolicy.ts');
const HOOKS_SCHEMA = join(root, 'resources', 'schemas', 'hooks.schema.json');
const PIPELINES_SCHEMA = join(root, 'resources', 'schemas', 'pipelines.schema.json');
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

/** Возвращает текст схемы хуков со строгим enum допустимых ключей */
function buildHooksSchemaText(ids) {
	const schema = JSON.parse(readFileSync(HOOKS_SCHEMA, 'utf8'));
	// "*" — wildcard на все команды, далее точные command id.
	schema.properties.hooks.propertyNames = { enum: ['*', ...ids] };
	return `${JSON.stringify(schema, null, 2)}\n`;
}

/** Возвращает текст схемы пайплайнов со строгим enum команд шага */
function buildPipelinesSchemaText(ids) {
	const schema = JSON.parse(readFileSync(PIPELINES_SCHEMA, 'utf8'));
	schema.properties.pipelines.items.properties.nodes.items.properties.command.enum = ids;
	return `${JSON.stringify(schema, null, 2)}\n`;
}

const isCheck = process.argv.includes('--check');
const ids = collectCommandIds();
const targets = [
	{ path: HOOKS_SCHEMA, name: 'hooks.schema.json', next: buildHooksSchemaText(ids) },
	{ path: PIPELINES_SCHEMA, name: 'pipelines.schema.json', next: buildPipelinesSchemaText(ids) },
];

/** Сравнение без учёта переводов строк: git на Windows разворачивает LF в CRLF */
const sameText = (a, b) => a.replaceAll('\r\n', '\n') === b.replaceAll('\r\n', '\n');

let stale = false;
for (const target of targets) {
	const current = readFileSync(target.path, 'utf8');
	if (isCheck) {
		if (!sameText(current, target.next)) {
			console.error(
				`${target.name} устарел: список command id не совпадает с манифестом.\n` +
					'Запустите `npm run gen:command-schemas` и закоммитьте результат.'
			);
			stale = true;
		}
		continue;
	}
	if (sameText(current, target.next)) {
		console.log(`${target.name} без изменений (${ids.length} command id).`);
	} else {
		writeFileSync(target.path, target.next, 'utf8');
		console.log(`${target.name} обновлён: ${ids.length} command id.`);
	}
}

if (isCheck) {
	if (stale) {
		process.exit(1);
	}
	console.log(`Схемы актуальны (${ids.length} command id).`);
}
