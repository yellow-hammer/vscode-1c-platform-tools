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
	source: 'metadataSourceConfigLike mdDesigner',
	externalRoot: 'metadataSourceExternalArtifact',
	group: 'metadataGroup_catalogs',
	groupWithoutCreate: 'metadataGroup_informationRegisters',
	catalog: 'metadataObjectProperties mdObjModule mdMgrModule mdDesigner',
	commonModule: 'metadataObjectProperties mdModule',
	commonForm: 'metadataObjectProperties mdFormModule',
	subsystem: 'metadataObjectPropertiesSubsystem',
	role: 'metadataObjectProperties',
	externalArtifact: 'metadataLeafFile',
	leafNoFile: 'metadataLeafNoFile',
	attributesSection: 'metadataObjectSection mdSectionAdd',
	otherSection: 'metadataObjectSection',
	dimensionsSection: 'metadataObjectSection mdSectionAdd',
	attribute: 'metadataChild_attribute mdChildEdit mdChildTyped mdChildDuplicate',
	tabularSection: 'metadataChild_tabularSection mdChildEdit mdChildDuplicate mdChildAdd',
	objectForm: 'metadataChild_form metadataObjectForm mdFormModule',
	readonlyChild: 'metadataChild_template',
	dimension: 'metadataChild_dimension mdChildEdit mdChildTyped mdChildDuplicate',
	command: 'metadataChild_command mdChildEdit',
	enumValue: 'metadataChild_value mdChildEdit mdChildDuplicate',
	edtSource: 'metadataSourceConfigLike mdEdt',
	edtCatalog: 'metadataObjectProperties mdObjModule mdMgrModule mdEdt',
	edtAttribute: 'metadataChild_attribute mdChildEdit mdChildTyped mdChildDuplicate mdEdt',
};

suite('контекстное меню дерева метаданных', () => {
	test('«Свойства» есть ровно у тех узлов, у которых свойства бывают', () => {
		const withProperties = [
			NODES.source,
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
		for (const viewItem of [
			NODES.externalRoot,
			NODES.group,
			NODES.groupWithoutCreate,
			NODES.leafNoFile,
			NODES.otherSection,
		]) {
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

	test('измерение, ресурс, значение и команда правятся наравне с реквизитом', () => {
		// md-sparrow умеет их все; раньше в меню были подключены только три вида
		for (const viewItem of [NODES.attribute, NODES.dimension, NODES.command]) {
			const menu = menuFor(viewItem);
			assert.ok(menu.includes('Переименовать'), `нет «Переименовать» у ${viewItem}`);
			assert.ok(menu.includes('Удалить'), `нет «Удалить» у ${viewItem}`);
		}
		// Дублирования команды объекта md-sparrow не умеет: пункта нет
		assert.ok(menuFor(NODES.dimension).includes('Дублировать'));
		assert.ok(!menuFor(NODES.command).includes('Дублировать'));
		// Состав макета не правится: свойства и открытие схемы компоновки
		assert.deepStrictEqual(menuFor(NODES.readonlyChild), ['Открыть схему компоновки', 'Свойства']);
	});

	test('«Добавить» есть у каждого раздела, куда md-sparrow умеет добавлять', () => {
		for (const viewItem of [NODES.attributesSection, NODES.dimensionsSection, NODES.tabularSection]) {
			assert.ok(menuFor(viewItem).includes('Добавить'), `нет «Добавить» у ${viewItem}`);
		}
		assert.ok(!menuFor(NODES.otherSection).includes('Добавить'));
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

	test('«Собрать» у корня выгрузки, внешнего файла и группы внешних файлов', () => {
		// Группа внешних файлов собирает всё содержимое разом
		for (const viewItem of [NODES.source, NODES.externalArtifact, NODES.externalRoot]) {
			assert.ok(menuFor(viewItem).includes('Собрать'), `нет «Собрать» у ${viewItem}`);
		}
		for (const viewItem of [NODES.catalog, NODES.role, NODES.group, NODES.attribute]) {
			assert.ok(!menuFor(viewItem).includes('Собрать'), `лишнее «Собрать» у ${viewItem}`);
		}
	});

	test('на корне выгрузки: смотрим, собираем, проверяем, свойства замыкают', () => {
		assert.deepStrictEqual(menuFor(NODES.source), [
			'Открыть модуль внешнего соединения',
			'Открыть модуль приложения',
			'Открыть модуль сеанса',
			'Открыть XML',
			'Собрать',
			'Проверить выгрузку',
			'Свойства',
		]);
	});

	test('у внешней обработки «Собрать» стоит после просмотра и до правок', () => {
		const menu = menuFor(NODES.externalArtifact);
		const compile = menu.indexOf('Собрать');
		const xml = menu.indexOf('Открыть XML');
		const rename = menu.indexOf('Переименовать');
		assert.ok(compile >= 0 && xml >= 0 && rename >= 0, `меню внешней обработки: ${menu.join(' → ')}`);
		assert.ok(xml < compile && compile < rename, `ожидался XML → Собрать → Переименовать, а не ${menu.join(' → ')}`);
	});

	test('порядок групп как в проводнике: открыть, показать, править, копировать, удалить, свойства', () => {
		const groups = (menus: string[]) => menus;
		const catalog = groups(menuFor(NODES.catalog));
		const order = [
			'Открыть модуль объекта',
			'Открыть XML',
			'Открыть ER-диаграмму объекта',
			'Переименовать',
			'Дублировать',
			'Копировать имя',
			'Копировать путь',
			'Удалить',
			'Свойства',
		];
		const positions = order.map((title) => catalog.indexOf(title));
		assert.ok(
			positions.every((value) => value >= 0),
			`в меню справочника не хватает пунктов: ${order.filter((_, i) => positions[i] < 0).join(', ')}`
		);
		const sorted = [...positions].sort((a, b) => a - b);
		assert.deepStrictEqual(positions, sorted, `порядок пунктов нарушен: ${catalog.join(' → ')}`);
	});

	test('поддержка стоит среди правок, а не среди копирования', () => {
		// Смена режима поддержки меняет объект: её место рядом с переименованием
		const supported = menuFor('metadataObjectProperties mdSupportRule');
		const order = ['Переименовать', 'Дублировать', 'Режим поддержки', 'Копировать имя', 'Удалить', 'Свойства'];
		const positions = order.map((title) => supported.indexOf(title));
		assert.ok(
			positions.every((value) => value >= 0),
			`в меню объекта на поддержке не хватает пунктов: ${supported.join(' → ')}`
		);
		assert.deepStrictEqual(positions, [...positions].sort((a, b) => a - b), supported.join(' → '));
	});

	test('на полной поддержке правило менять нечем: только снятие', () => {
		// Возможность изменения включает конфигуратор: он же кладёт рядом файл поставки
		const locked = menuFor('metadataSourceConfigLike mdSupportRules mdDesigner');
		const order = ['Собрать', 'Снять с поддержки', 'Проверить выгрузку', 'Свойства'];
		const positions = order.map((title) => locked.indexOf(title));
		assert.ok(positions.every((value) => value >= 0), locked.join(' → '));
		assert.deepStrictEqual(positions, [...positions].sort((a, b) => a - b), locked.join(' → '));
		assert.ok(!locked.includes('Режим поддержки'), 'правила ещё не включены');
	});

	test('у конфигурации с действующими правилами правило поддержки и снятие', () => {
		// Окно правила у конфигуратора одно на все субъекты, корень конфигурации в нём тоже узел
		const open = menuFor('metadataSourceConfigLike mdSupportRules mdSupportRule');
		const order = ['Режим поддержки', 'Снять с поддержки'];
		const positions = order.map((title) => open.indexOf(title));
		assert.ok(positions.every((value) => value >= 0), open.join(' → '));
		assert.deepStrictEqual(positions, [...positions].sort((a, b) => a - b), open.join(' → '));
		assert.ok(!open.includes('Включить возможность изменения'), 'правила уже действуют');
	});

	test('«Изменить тип» только у узлов, у которых есть тип', () => {
		for (const viewItem of [NODES.attribute, NODES.dimension, NODES.edtAttribute]) {
			assert.ok(menuFor(viewItem).includes('Изменить тип'), `нет «Изменить тип» у ${viewItem}`);
		}
		for (const viewItem of [NODES.tabularSection, NODES.command, NODES.enumValue, NODES.objectForm, NODES.catalog]) {
			assert.ok(!menuFor(viewItem).includes('Изменить тип'), `лишнее «Изменить тип» у ${viewItem}`);
		}
	});

	test('у проекта EDT есть проверка и заимствование в расширение', () => {
		const source = menuFor(NODES.edtSource);
		assert.ok(source.includes('Проверить выгрузку'), source.join(' → '));
		assert.ok(source.includes('Открыть модуль сеанса') && source.includes('Свойства'), source.join(' → '));
		const catalog = menuFor(NODES.edtCatalog);
		assert.ok(catalog.includes('Добавить объект в расширение'), catalog.join(' → '));
		assert.ok(catalog.includes('Открыть модуль объекта') && catalog.includes('Переименовать'), catalog.join(' → '));
		assert.ok(menuFor(NODES.source).includes('Проверить выгрузку'));
		assert.ok(menuFor(NODES.catalog).includes('Добавить объект в расширение'));
	});

	test('у группы и узла без файла меню пустое', () => {
		assert.deepStrictEqual(menuFor(NODES.groupWithoutCreate), []);
		assert.deepStrictEqual(menuFor(NODES.leafNoFile), []);
		assert.deepStrictEqual(menuFor(NODES.otherSection), []);
	});
});
