/**
 * Тесты ER-фильтров и экспортёров на реальной фикстуре графа.
 *
 * Фикстура {@code src/test/fixtures/er/ssl31-anketirovanie.json} — это подграф SSL3.1, выбранный
 * вокруг подсистемы {@code _ДемоАнкетирование} (1-hop соседей). Получен через
 * {@code md-sparrow cf-md-graph} против submodule {@code ssl_3_1} и зафиксирован в репозитории
 * (см. README рядом). Так тесты работают с реальными ключами/связями типовой выгрузки, а не с
 * самописанными литералами.
 *
 * @module test/metadata/er
 */

import * as assert from 'node:assert';
import * as fs from 'node:fs';
import * as path from 'node:path';
import {
	buildSubgraph,
	listObjectTypes,
	listRelationKinds,
	neighboursOf,
	nodesInSubsystem,
} from '../../features/metadata/er/erFilters';
import { exportDrawio } from '../../features/metadata/er/erExporters/drawioExporter';
import { exportMermaid } from '../../features/metadata/er/erExporters/mermaidExporter';
import type { ErExportRequest, ErGraph, ErScope } from '../../features/metadata/er/erTypes';

const FIXTURE_PATH = resolveFixturePath('er/ssl31-anketirovanie.json');

function resolveFixturePath(relInsideFixtures: string): string {
	let dir = __dirname;
	for (let i = 0; i < 10; i++) {
		if (fs.existsSync(path.join(dir, 'package.json'))) {
			return path.join(dir, 'src', 'test', 'fixtures', relInsideFixtures);
		}
		const parent = path.dirname(dir);
		if (parent === dir) {
			break;
		}
		dir = parent;
	}
	throw new Error(`Не найден корень проекта (package.json) при поиске фикстуры ${relInsideFixtures}`);
}

const ROOT_SUBSYSTEM = 'Subsystem._ДемоАнкетирование';
const NESTED_SUBSYSTEM = 'Subsystem.СозданиеАнкетИОпросов';
const ANKETA_DOC = 'Document.Анкета';
const TEMPLATE_CATALOG = 'Catalog.ШаблоныАнкет';
const QUESTIONS_CATALOG = 'Catalog.ВопросыШаблонаАнкеты';
const VARIANTS_CATALOG = 'Catalog.ВариантыОтветовАнкет';
const QUESTION_TYPE_ENUM = 'Enum.ТипыВопросовШаблонаАнкеты';
const QUESTIONS_CHARACTERISTIC = 'ChartOfCharacteristicTypes.ВопросыДляАнкетирования';
const SECTION_ROLE = 'Role.Подсистема_ДемоАнкетирование';

const graph: ErGraph = loadFixture();

function loadFixture(): ErGraph {
	const raw = fs.readFileSync(FIXTURE_PATH, 'utf8');
	return JSON.parse(raw) as ErGraph;
}

function makeScope(partial: Partial<ErScope> & Pick<ErScope, 'kind'>): ErScope {
	return {
		label: 'тест',
		seeds: [],
		hops: 0,
		objectTypes: [],
		relationKinds: null,
		...partial,
	};
}

suite('er/erFilters (фикстура SSL3.1: _ДемоАнкетирование)', () => {
	test('фикстура содержит ожидаемые опорные узлы и связи', () => {
		const keys = new Set(graph.nodes.map((n) => n.key));
		for (const expected of [
			ROOT_SUBSYSTEM,
			NESTED_SUBSYSTEM,
			ANKETA_DOC,
			TEMPLATE_CATALOG,
			QUESTIONS_CATALOG,
			VARIANTS_CATALOG,
			QUESTION_TYPE_ENUM,
			QUESTIONS_CHARACTERISTIC,
			SECTION_ROLE,
		]) {
			assert.ok(keys.has(expected), `в фикстуре должен быть ${expected}`);
		}
		const kinds = new Set(graph.edges.map((e) => e.kind));
		for (const k of [
			'subsystemMembership',
			'subsystemNesting',
			'catalogOwners',
			'typeComposite',
			'roleObjectRights',
			'valueType',
			'functionalOptionLocation',
			'functionalOptionAffected',
		]) {
			assert.ok(kinds.has(k), `в фикстуре должны быть рёбра вида ${k}`);
		}
	});

	test('scope=all возвращает весь граф', () => {
		const sub = buildSubgraph(graph, makeScope({ kind: 'all' }));
		assert.strictEqual(sub.nodes.length, graph.nodes.length);
		assert.strictEqual(sub.edges.length, graph.edges.length);
	});

	test('scope=object без hops возвращает только seed-узел', () => {
		const sub = buildSubgraph(graph, makeScope({ kind: 'object', seeds: [ANKETA_DOC], hops: 0 }));
		assert.strictEqual(sub.nodes.length, 1);
		assert.strictEqual(sub.nodes[0]?.key, ANKETA_DOC);
		assert.strictEqual(sub.edges.length, 0);
	});

	test('scope=object с hops=1 раскрывает соседей в обе стороны', () => {
		const sub = buildSubgraph(graph, makeScope({ kind: 'object', seeds: [QUESTIONS_CATALOG], hops: 1 }));
		const keys = new Set(sub.nodes.map((n) => n.key));
		assert.ok(keys.has(QUESTIONS_CATALOG));
		assert.ok(keys.has(TEMPLATE_CATALOG), 'через owners должны подтянуться шаблоны');
		assert.ok(keys.has(QUESTION_TYPE_ENUM), 'через typeComposite должны подтянуться типы вопросов');
		assert.ok(keys.has(ROOT_SUBSYSTEM), 'через subsystemMembership должна подтянуться подсистема');
		for (const e of sub.edges) {
			assert.ok(keys.has(e.sourceKey));
			assert.ok(keys.has(e.targetKey));
		}
	});

	test('фильтр по relationKinds оставляет только нужные рёбра', () => {
		const sub = buildSubgraph(
			graph,
			makeScope({ kind: 'all', relationKinds: ['catalogOwners', 'typeComposite'] })
		);
		assert.ok(sub.edges.length > 0);
		for (const e of sub.edges) {
			assert.ok(['catalogOwners', 'typeComposite'].includes(e.kind));
		}
	});

	test('фильтр по objectTypes исключает узлы и связанные с ними рёбра', () => {
		const allowed = ['Catalog', 'Subsystem'];
		const sub = buildSubgraph(graph, makeScope({ kind: 'all', objectTypes: allowed }));
		for (const n of sub.nodes) {
			assert.ok(allowed.includes(n.objectType));
		}
		const keys = new Set(sub.nodes.map((n) => n.key));
		for (const e of sub.edges) {
			assert.ok(keys.has(e.sourceKey), `источник ${e.sourceKey} должен быть в узлах`);
			assert.ok(keys.has(e.targetKey), `цель ${e.targetKey} должна быть в узлах`);
		}
	});

	test('scope=subsystem с seed-подсистемой и hops=1 включает её объекты', () => {
		const sub = buildSubgraph(
			graph,
			makeScope({ kind: 'subsystem', seeds: [ROOT_SUBSYSTEM], hops: 1 })
		);
		const keys = new Set(sub.nodes.map((n) => n.key));
		assert.ok(keys.has(ROOT_SUBSYSTEM));
		assert.ok(keys.has(ANKETA_DOC));
		assert.ok(keys.has(TEMPLATE_CATALOG));
		assert.ok(keys.has(NESTED_SUBSYSTEM));
	});

	test('neighboursOf разделяет входящие и исходящие рёбра', () => {
		const result = neighboursOf(graph, QUESTIONS_CATALOG);
		assert.ok(result.outgoing.length > 0, 'у каталога должны быть исходящие рёбра (owners, typeComposite, …)');
		assert.ok(result.incoming.length > 0, 'у каталога должны быть входящие (subsystemMembership)');
		const incomingFromSubsystem = result.incoming.filter(
			(e) => e.sourceKey === ROOT_SUBSYSTEM && e.kind === 'subsystemMembership'
		);
		assert.ok(
			incomingFromSubsystem.length > 0,
			'входящее subsystemMembership от _ДемоАнкетирование должно быть'
		);
	});

	test('nodesInSubsystem возвращает все узлы подсистемы', () => {
		const list = nodesInSubsystem(graph, ROOT_SUBSYSTEM);
		const keys = new Set(list.map((n) => n.key));
		for (const expected of [ANKETA_DOC, TEMPLATE_CATALOG, QUESTIONS_CATALOG, SECTION_ROLE]) {
			assert.ok(keys.has(expected), `ожидается ${expected} в подсистеме`);
		}
	});

	test('listRelationKinds возвращает уникальные виды связи (отсортированы)', () => {
		const kinds = listRelationKinds(graph);
		const sorted = [...kinds].sort((a, b) => a.localeCompare(b));
		assert.deepStrictEqual(kinds, sorted, 'listRelationKinds должен быть отсортирован');
		assert.deepStrictEqual(kinds, Array.from(new Set(kinds)), 'без дублей');
		assert.ok(kinds.includes('subsystemMembership'));
		assert.ok(kinds.includes('catalogOwners'));
	});

	test('listObjectTypes возвращает уникальные типы объектов (отсортированы)', () => {
		const types = listObjectTypes(graph);
		const sorted = [...types].sort((a, b) => a.localeCompare(b));
		assert.deepStrictEqual(types, sorted, 'listObjectTypes должен быть отсортирован');
		assert.deepStrictEqual(types, Array.from(new Set(types)), 'без дублей');
		for (const expected of ['Subsystem', 'Catalog', 'Document', 'Role', 'Enum']) {
			assert.ok(types.includes(expected), `должен быть тип ${expected}`);
		}
	});
});

suite('er/exporters/mermaid (фикстура SSL3.1)', () => {
	test('mermaid содержит блок ```mermaid и flowchart LR с реальными узлами', () => {
		const sub = buildSubgraph(graph, makeScope({ kind: 'all' }));
		const req: ErExportRequest = {
			subgraph: sub,
			scope: makeScope({ kind: 'all' }),
			generatedAtIso: '2026-01-01T00:00:00.000Z',
		};
		const result = exportMermaid(req);
		assert.strictEqual(result.fileExtension, 'md');
		const text = String(result.content);
		assert.ok(text.includes('```mermaid'));
		assert.ok(text.includes('flowchart LR'));
		assert.ok(text.includes('Документ • Анкета'), 'ожидался узел Документ • Анкета');
		assert.ok(text.includes('Подсистема • «Анкетирование»'), 'ожидался узел Подсистема • «Анкетирование»');
	});

	test('для scope=subsystem подпись ребра — только kind, без via', () => {
		const scope = makeScope({ kind: 'subsystem', seeds: [ROOT_SUBSYSTEM], hops: 1 });
		const sub = buildSubgraph(graph, scope);
		const text = String(exportMermaid({ subgraph: sub, scope, generatedAtIso: '2026-01-01T00:00:00.000Z' }).content);
		assert.ok(text.includes('|"В подсистеме"|'), 'ожидался русский лейбл В подсистеме');
		assert.ok(!text.includes('В подсистеме: content['), 'для подсистемы via в подписи быть не должно');
	});

	test('для scope=object подписи рёбер содержат kind и via', () => {
		const scope = makeScope({ kind: 'object', seeds: [QUESTIONS_CATALOG], hops: 1 });
		const sub = buildSubgraph(graph, scope);
		const text = String(exportMermaid({ subgraph: sub, scope, generatedAtIso: '2026-01-01T00:00:00.000Z' }).content);
		assert.ok(/Тип: [^|]+\|/.test(text), `ожидался Тип: <attr>|; got:\n${text}`);
		assert.ok(text.includes('|"Владелец"|'), 'ожидалась метка Владелец для catalogOwners');
	});

	test('экранирует двойные кавычки в синонимах ролей (Раздел "Анкетирование")', () => {
		const sub = buildSubgraph(graph, makeScope({ kind: 'object', seeds: [SECTION_ROLE], hops: 0 }));
		const text = String(
			exportMermaid({
				subgraph: sub,
				scope: makeScope({ kind: 'object', seeds: [SECTION_ROLE], hops: 0 }),
				generatedAtIso: '2026-01-01T00:00:00.000Z',
			}).content
		);
		const expected = '«Раздел #quot;Анкетирование#quot;»';
		assert.ok(text.includes(expected), `ожидалось экранированное ${expected}, got:\n${text}`);
	});
});

suite('er/exporters/drawio (фикстура SSL3.1)', () => {
	test('drawio возвращает корректный XML с mxfile и реальными узлами', () => {
		const scope = makeScope({ kind: 'all', label: 'весь подграф' });
		const sub = buildSubgraph(graph, scope);
		const result = exportDrawio({ subgraph: sub, scope, generatedAtIso: '2026-01-01T00:00:00.000Z' });
		assert.strictEqual(result.fileExtension, 'drawio');
		const text = String(result.content);
		assert.ok(text.startsWith('<?xml version="1.0" encoding="UTF-8"?>'));
		assert.ok(text.includes('<mxfile host="vscode-1c-platform-tools">'));
		assert.ok(text.includes('Документ\nАнкета'), 'ожидался узел Документ\\nАнкета в drawio');
		assert.ok(text.includes('endArrow=classic'));
	});

	test('экранирует спецсимволы XML в синонимах (двойные кавычки → &quot;)', () => {
		const scope = makeScope({ kind: 'object', seeds: [SECTION_ROLE], hops: 0 });
		const sub = buildSubgraph(graph, scope);
		const text = String(exportDrawio({ subgraph: sub, scope, generatedAtIso: '2026-01-01T00:00:00.000Z' }).content);
		assert.ok(
			text.includes('Раздел &quot;Анкетирование&quot;'),
			`ожидалось экранированное «Раздел &quot;Анкетирование&quot;», got:\n${text}`
		);
	});
});
