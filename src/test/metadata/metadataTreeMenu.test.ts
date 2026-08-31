import * as assert from 'node:assert';
import * as path from 'node:path';
import * as fs from 'node:fs';

const EXTENSION_ROOT = path.resolve(__dirname, '../../..');
const VIEW = '1c-platform-tools-metadata-tree';

interface MenuEntry {
	command?: string;
	when?: string;
	group?: string;
}

function contributes(): {
	commands: Array<{ command: string; title: string }>;
	menus: Record<string, MenuEntry[]>;
} {
	return JSON.parse(fs.readFileSync(path.join(EXTENSION_ROOT, 'package.json'), 'utf8')).contributes;
}

/**
 * Разбирает when-условие меню так же, как VS Code: ==, !=, =~, !~, && и ||.
 *
 * Проверка нужна именно на строке contextValue: у узла она составная (вид узла
 * плюс токены возможностей), и сравнение `viewItem == вид` на такой строке молча
 * перестаёт срабатывать.
 */
function evaluateWhen(expression: string, viewItem: string): boolean {
	const regexLiteral = String.raw`\/(?:[^/\\]|\\.)*\/[a-z]*`;
	let code = expression;
	code = code.replace(/1c-platform-tools\.[A-Za-z.]+/g, 'false');
	code = code.replace(new RegExp(`(\\S+)\\s*=~\\s*(${regexLiteral})`, 'g'), (_, left, re) => `(${re}.test(${left}))`);
	code = code.replace(new RegExp(`(\\S+)\\s*!~\\s*(${regexLiteral})`, 'g'), (_, left, re) => `(!${re}.test(${left}))`);
	code = code.replace(/(==|!=)\s*'([^']*)'/g, (_, op, value) => `${op} ${JSON.stringify(value)}`);
	code = code.replace(/(==|!=)\s*([A-Za-z0-9_.-]+)/g, (_, op, value) =>
		value === 'true' || value === 'false' ? `${op} ${value}` : `${op} ${JSON.stringify(value)}`
	);
	code = code.replace(/\bview\b(?!Item)/g, JSON.stringify(VIEW));
	code = code.replace(/\bviewItem\b/g, JSON.stringify(viewItem));
	code = code.replace(/([^=!<>])==([^=])/g, '$1===$2');
	code = code.replace(/([^!])!=([^=])/g, '$1!==$2');
	return Boolean(new Function(`"use strict";return (${code});`)());
}

/** Пункты контекстного меню узла, в порядке групп. */
function menuFor(viewItem: string): string[] {
	const { commands, menus } = contributes();
	const titles = new Map(commands.map((command) => [command.command, command.title]));
	return (menus['view/item/context'] ?? [])
		.filter((entry) => (entry.when ?? '').includes(VIEW) && entry.group !== 'inline')
		.filter((entry) => evaluateWhen(entry.when as string, viewItem))
		.sort((a, b) => (a.group ?? '').localeCompare(b.group ?? ''))
		.map((entry) => titles.get(entry.command as string) ?? (entry.command as string));
}

/** contextValue узлов дерева: собирается в metadataTreeView по виду объекта. */
const NODES = {
	source: 'metadataSourceConfigLike',
	externalRoot: 'metadataSourceExternalArtifact',
	group: 'metadataGroup_catalogs',
	groupWithoutCreate: 'metadataGroup_informationRegisters',
	catalog: 'metadataObjectProperties mdObjModule mdMgrModule',
	commonModule: 'metadataObjectProperties mdModule',
	commonForm: 'metadataObjectProperties mdFormModule',
	subsystem: 'metadataObjectPropertiesSubsystem',
	role: 'metadataObjectProperties',
	externalArtifact: 'metadataLeafFile',
	leafNoFile: 'metadataLeafNoFile',
	attributesSection: 'metadataAttributesSection',
	otherSection: 'metadataObjectSection',
	attribute: 'metadataAttribute',
	tabularSection: 'metadataTabularSection',
	objectForm: 'metadataObjectForm mdFormModule',
	readonlyChild: 'metadataObjectChildReadonly',
};

suite('контекстное меню дерева метаданных', () => {
	test('«Свойства» есть ровно у тех узлов, у которых свойства бывают', () => {
		const withProperties = [
			NODES.source,
			NODES.externalRoot,
			NODES.catalog,
			NODES.commonModule,
			NODES.commonForm,
			NODES.subsystem,
			NODES.role,
			NODES.externalArtifact,
			NODES.attribute,
			NODES.tabularSection,
			NODES.objectForm,
			NODES.readonlyChild,
		];
		for (const viewItem of withProperties) {
			assert.ok(menuFor(viewItem).includes('Свойства'), `нет «Свойства» у ${viewItem}`);
		}
		for (const viewItem of [NODES.group, NODES.groupWithoutCreate, NODES.leafNoFile, NODES.otherSection]) {
			assert.ok(!menuFor(viewItem).includes('Свойства'), `лишние «Свойства» у ${viewItem}`);
		}
	});

	test('«Свойства» в меню одни: второго названия для того же действия нет', () => {
		for (const viewItem of Object.values(NODES)) {
			const properties = menuFor(viewItem).filter((title) => title.startsWith('Свойства'));
			assert.ok(properties.length <= 1, `у ${viewItem} несколько пунктов свойств: ${properties.join(', ')}`);
		}
	});

	test('«Добавить» живёт на разделе состава, а не на самом объекте', () => {
		// На объекте непонятно, что добавляют: реквизит, табличную часть, форму или макет.
		// Добавляют внутрь раздела, поэтому пункт стоит на нём.
		for (const viewItem of [NODES.attributesSection, NODES.tabularSection]) {
			assert.ok(menuFor(viewItem).includes('Добавить'), `нет «Добавить» у ${viewItem}`);
		}
		for (const viewItem of [NODES.catalog, NODES.role, NODES.commonModule, NODES.commonForm, NODES.subsystem]) {
			assert.ok(!menuFor(viewItem).includes('Добавить'), `лишнее «Добавить» у ${viewItem}`);
		}
	});

	test('ER-диаграмма у каждого объекта: связи бывают и входящие', () => {
		// Общий модуль виден в регламентном задании и подписке на событие, язык -
		// в объектах: отбирать по исходящим связям нельзя, диаграмма показывает обе стороны
		for (const viewItem of [
			NODES.catalog,
			NODES.subsystem,
			NODES.externalArtifact,
			NODES.commonModule,
			NODES.commonForm,
			NODES.role,
		]) {
			assert.ok(menuFor(viewItem).includes('Открыть ER-диаграмму объекта'), `нет ER у ${viewItem}`);
		}
	});

	test('у формы два XML: описание и содержимое', () => {
		const form = menuFor(NODES.objectForm);
		assert.ok(form.includes('Открыть XML'), 'нет XML описания формы');
		assert.ok(form.includes('Открыть XML содержимого'), 'нет XML содержимого формы');
		// У обычного объекта содержимого формы нет
		assert.ok(!menuFor(NODES.catalog).includes('Открыть XML содержимого'));
	});

	test('«Открыть XML» у каждого узла с файлом', () => {
		for (const viewItem of [NODES.source, NODES.catalog, NODES.subsystem, NODES.role, NODES.externalArtifact]) {
			assert.ok(menuFor(viewItem).includes('Открыть XML'), `нет «Открыть XML» у ${viewItem}`);
		}
	});

	test('токен вида не ломает отбор по виду узла', () => {
		// Сравнение viewItem == вид на составной строке молча выключало бы пункт
		assert.deepStrictEqual(
			menuFor('metadataLeafFile mdEr').filter((title) => title !== 'Открыть модуль объекта'),
			menuFor(NODES.externalArtifact)
		);
		assert.ok(menuFor(NODES.subsystem).includes('Фильтр по подсистеме'));
	});

	test('порядок групп сквозной: открыть, свойства, показать, создать, править, удалить', () => {
		const groups = (menus: string[]) => menus;
		const catalog = groups(menuFor(NODES.catalog));
		const order = [
			'Открыть модуль объекта',
			'Свойства',
			'Открыть XML',
			'Открыть ER-диаграмму объекта',
			'Переименовать',
			'Дублировать',
			'Удалить',
			'Копировать имя',
		];
		const positions = order.map((title) => catalog.indexOf(title));
		assert.ok(
			positions.every((value) => value >= 0),
			`в меню справочника не хватает пунктов: ${order.filter((_, i) => positions[i] < 0).join(', ')}`
		);
		const sorted = [...positions].sort((a, b) => a - b);
		assert.deepStrictEqual(positions, sorted, `порядок пунктов нарушен: ${catalog.join(' → ')}`);
	});

	test('у группы и узла без файла меню пустое', () => {
		assert.deepStrictEqual(menuFor(NODES.groupWithoutCreate), []);
		assert.deepStrictEqual(menuFor(NODES.leafNoFile), []);
		assert.deepStrictEqual(menuFor(NODES.otherSection), []);
	});
});
