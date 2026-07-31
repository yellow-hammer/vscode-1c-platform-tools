// Собирает текстовое дерево панели «Инструменты 1С» из treeStructure.ts и вставляет
// его в документацию между маркерами. Панель меняется часто, а картинка в документации
// устаревает молча — текст же собирается из того же источника, что и сама панель.
//
// Использование:
//   node scripts/gen-commands-tree.mjs           — перезаписать блоки в документации
//   node scripts/gen-commands-tree.mjs --check    — проверить, что блоки не устарели (exit 1)
//
// Запускается в pretest вместе с проверкой схем команд.

import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const STRUCTURE = join(root, 'src', 'features', 'tools', 'treeStructure.ts');
const BEGIN = '<!-- дерево команд: начало (собирается gen-commands-tree.mjs) -->';
const END = '<!-- дерево команд: конец -->';

/** Файлы, куда вставляется дерево. */
const TARGETS = [
	join(root, 'docs', 'tools.md'),
	join(root, 'walkthrough', 'step3-commands-panel.md'),
];

/**
 * Разбирает treeStructure.ts: группы в порядке объявления и подписи их команд.
 *
 * Берётся исходник, а не собранный модуль: структура — статические литералы,
 * а импорт TypeScript из скрипта потребовал бы сборки.
 */
function readGroups() {
	const source = readFileSync(STRUCTURE, 'utf8');
	const groups = [];
	const groupRe = /groupLabel:\s*'([^']+)'/g;
	const bounds = [...source.matchAll(groupRe)].map((match) => ({
		label: match[1],
		start: match.index,
	}));
	if (bounds.length === 0) {
		throw new Error(`Не найдено ни одной группы в ${STRUCTURE}`);
	}
	for (const [index, group] of bounds.entries()) {
		const end = index + 1 < bounds.length ? bounds[index + 1].start : source.length;
		const block = source.slice(group.start, end);
		const items = [...block.matchAll(/treeLabel:\s*'([^']+)'/g)].map((match) => match[1]);
		groups.push({ label: group.label, items });
	}
	return groups;
}

/** Рисует дерево символами рамок, как его видно в панели. */
function renderTree(groups) {
	const lines = ['ИНСТРУМЕНТЫ 1С'];
	for (const [groupIndex, group] of groups.entries()) {
		const lastGroup = groupIndex === groups.length - 1;
		lines.push(`${lastGroup ? '└─' : '├─'} ${group.label}`);
		const prefix = lastGroup ? '   ' : '│  ';
		for (const [itemIndex, item] of group.items.entries()) {
			const lastItem = itemIndex === group.items.length - 1;
			lines.push(`${prefix}${lastItem ? '└─' : '├─'} ${item}`);
		}
	}
	return lines.join('\n');
}

/** Заменяет содержимое между маркерами; текст вне маркеров не трогается. */
function withTree(text, tree, file) {
	const begin = text.indexOf(BEGIN);
	const end = text.indexOf(END);
	if (begin < 0 || end < 0) {
		throw new Error(`В ${file} нет маркеров дерева команд`);
	}
	const block = `${BEGIN}\n\n\`\`\`text\n${tree}\n\`\`\`\n\n`;
	return text.slice(0, begin) + block + text.slice(end);
}

const isCheck = process.argv.includes('--check');
const tree = renderTree(readGroups());

let stale = false;
for (const file of TARGETS) {
	const current = readFileSync(file, 'utf8');
	const next = withTree(current, tree, file);
	const same = current.replaceAll('\r\n', '\n') === next.replaceAll('\r\n', '\n');
	if (isCheck) {
		if (!same) {
			console.error(
				`${file}: дерево команд устарело.\n` +
					'Запустите `npm run gen:commands-tree` и закоммитьте результат.'
			);
			stale = true;
		}
		continue;
	}
	if (same) {
		console.log(`${file}: без изменений.`);
	} else {
		writeFileSync(file, next, 'utf8');
		console.log(`${file}: дерево команд обновлено.`);
	}
}

if (isCheck) {
	if (stale) {
		process.exit(1);
	}
	console.log('Дерево команд в документации актуально.');
}
