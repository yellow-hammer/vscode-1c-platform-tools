/**
 * Правила редактора СКД: чего окна не предлагают, потому что загрузка в платформу (ibcmd 8.3.27)
 * это молча отбрасывает, — и сверка с отказами md-sparrow.
 *
 * Правила живут в скрипте редактора (dcs-editor.js и модули закладок): решения вынесены в чистые функции, и тесты исполняют их
 * как есть (node:vm через new Function) — проверяется поведение, а не текст. По тексту проверяется только
 * подключение: что окно и таблица вызывают эти функции. Отказы md-sparrow, которые окна повторяют, лежат
 * снимком в фикстуре md-sparrow-refusals.json: списки окна сверяются с ним всегда (и в CI). Если рядом с
 * проектом лежит исходник md-sparrow (../md-sparrow или переменная MD_SPARROW_SRC), снимок сверяется и
 * с его константами; без исходника эта сверка пропускается с явной диагностикой в выводе теста. Так же
 * сверяются «нет» флажка «Список параметров», которое md-sparrow сам пишет у связи с параметром, и отказ «да» без
 * параметра. С заданным MD_SPARROW_JAR payload окна связи и все имена словаря параметров вывода на каждом уровне
 * прогоняются через живой jar: то, что окно шлёт, проходит, а то, чего оно не предлагает, jar отклоняет.
 * Предупреждение о списке значений старой записи сверяется по поведению: снимок ответов md-sparrow на варианты
 * (legacy-value-lists.json с Template-legacy-lists.xml) прогоняется правилом редактора всегда, а с заданным
 * MD_SPARROW_JAR снимок сверяется с живым jar (скрипт legacy-value-lists.mjs --check).
 * Запуск: npm run compile && node --test out/test/metadata/dcsPlatformRules.node.js
 */
import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { readEditorScript } from '../fixtures/helpers/dcsEditorScript';

// esbuild кладёт тест в out/test/metadata: до корня проекта три уровня вверх
const ROOT = path.resolve(__dirname, '../../..');
const WEBVIEW = path.join(ROOT, 'resources', 'webview');
const FIXTURES = path.join(ROOT, 'src', 'test', 'fixtures', 'dcs');

/** Концы строк приводятся к \n: рабочая копия на Windows может хранить файлы с \r\n (autocrlf). */
function read(file: string): string {
	return fs.readFileSync(file, 'utf8').replace(/\r\n/g, '\n');
}

const SCRIPT = readEditorScript();

/** Кусок текста от начала `from` до начала `to` (оба обязаны быть, `to` — после `from`). */
function between(text: string, from: string, to: string): string {
	const start = text.indexOf(from);
	assert.ok(start >= 0, `нет ${from}`);
	const end = text.indexOf(to, start + from.length);
	assert.ok(end > start, `нет ${to} после ${from}`);
	return text.slice(start, end);
}

/** Раздел dcs-editor.js от `from` до `to`, исполненный как есть: чистые функции без DOM (prelude — заглушки соседей). */
function load<T>(from: string, to: string, names: string[], prelude = ''): T {
	const factory = new Function(`${prelude}${between(SCRIPT, from, to)}\nreturn { ${names.join(', ')} };`) as () => T;
	return factory();
}

/** Исходник md-sparrow рядом с проектом: путь к файлу или undefined, если его нет. */
function mdSparrowFile(relative: string): string | undefined {
	const roots = [process.env.MD_SPARROW_SRC, path.resolve(ROOT, '..', 'md-sparrow')].filter(
		(candidate): candidate is string => Boolean(candidate)
	);
	for (const root of roots) {
		const file = path.join(root, relative);
		if (fs.existsSync(file)) {
			return file;
		}
	}
	return undefined;
}

const JAVA_CF = path.join('src', 'main', 'java', 'io', 'github', 'yellowhammer', 'designerxml', 'cf');

interface Refusals {
	rootForbiddenOutputParameters: string[];
	groupForbiddenOutputParameters: string[];
	tableForbiddenOutputParameters: string[];
	tableGroupForbiddenOutputParameters: string[];
	chartForbiddenOutputParameters: string[];
	chartGroupForbiddenOutputParameters: string[];
	linkRequiredRefused: boolean;
	linkParameterListDefault: string;
	linkListFlagWithoutParameterRefused: boolean;
	linkListFlagWithoutParameterKind: string;
}

/** Снимок отказов md-sparrow, которые повторяют окна (см. about в самой фикстуре). */
const REFUSALS = JSON.parse(read(path.join(FIXTURES, 'md-sparrow-refusals.json'))) as Refusals;

/** Без исходника md-sparrow сверка снимка пропускается, но не молча: строка диагностики в выводе node --test. */
function skipWithoutSource(t: { diagnostic(message: string): void; skip(message: string): void }, what: string): void {
	t.diagnostic(`снимок md-sparrow-refusals.json не сверен с исходником md-sparrow (${what}): задайте MD_SPARROW_SRC`);
	t.skip('исходника md-sparrow рядом нет');
}

const sorted = (names: readonly string[]): string[] => [...names].sort((a, b) => a.localeCompare(b, 'ru'));

interface LegacyListsSnapshot {
	template: string;
	templateSha256: string;
	info: { parameters: Array<{ name: string; valueListAllowed?: boolean; valueTyped?: unknown }> };
	validate: { ok: boolean; errors: unknown[]; warnings: Array<{ message: string; parameter: string; kind: string }> };
}

/**
 * Снимок ответов md-sparrow на варианты списка старой записи (legacy-value-lists.json, снят скриптом
 * legacy-value-lists.mjs с Template-legacy-lists.xml): правило редактора сверяется с ним всегда (и в CI), а сам
 * снимок с живым jar — если задан MD_SPARROW_JAR.
 */
const LEGACY_LISTS = JSON.parse(read(path.join(FIXTURES, 'legacy-value-lists.json'))) as LegacyListsSnapshot;

/** java для сверки с живым jar: MD_SPARROW_JAVA, java из JAVA_HOME или из PATH. */
function javaForJar(): string {
	if (process.env.MD_SPARROW_JAVA) {
		return process.env.MD_SPARROW_JAVA;
	}
	if (process.env.JAVA_HOME) {
		return path.join(process.env.JAVA_HOME, 'bin', process.platform === 'win32' ? 'java.exe' : 'java');
	}
	return 'java';
}

interface LinkRules {
	LINK_REQUIRED_REASON: string;
	linkLabel(link: Record<string, unknown>, index: number): string;
	linkRequiredOffered(link: Record<string, unknown> | null): boolean;
	linkRequiredChange(link: Record<string, unknown> | null, checked: boolean): false | undefined;
	linkRequiredPlate(links: Array<Record<string, unknown>>): string;
}

describe('Связи наборов: обязательность (required)', () => {
	const rules = load<LinkRules>('const LINK_REQUIRED_REASON =', 'function renderLinks(', [
		'LINK_REQUIRED_REASON',
		'linkLabel',
		'linkRequiredOffered',
		'linkRequiredChange',
		'linkRequiredPlate',
	]);
	const renderLinks = between(SCRIPT, 'function renderLinks(', 'function openLinkDialog(');
	const dialog = between(SCRIPT, 'function openLinkDialog(', '// ---------- вкладка «Вычисляемые поля»');
	const price = (expression: string, required?: boolean): Record<string, unknown> => ({
		source: 'Продажи',
		destination: 'Цены',
		sourceExpression: expression,
		destinationExpression: expression,
		...(required === undefined ? {} : { required }),
	});

	test('флажок предлагается только у связи, где он записан; уходит только снятие', () => {
		assert.equal(rules.linkRequiredOffered(null), false, 'новая связь');
		assert.equal(rules.linkRequiredOffered(price('Склад')), false, 'флажка в файле нет');
		assert.equal(rules.linkRequiredOffered(price('Склад', false)), false, 'записан false');
		assert.equal(rules.linkRequiredOffered(price('Склад', true)), true);
		assert.equal(rules.linkRequiredChange(price('Склад', true), false), false, 'снятие записанного');
		assert.equal(rules.linkRequiredChange(price('Склад', true), true), undefined, 'флажок не трогали');
		assert.equal(rules.linkRequiredChange(price('Склад'), true), undefined, 'true окно не шлёт никогда');
		assert.equal(rules.linkRequiredChange(price('Склад'), false), undefined, 'false у связи без флажка не пишется');
		assert.equal(rules.linkRequiredChange(null, false), undefined);
	});

	test('плашка называет связи однозначно: номер строки и выражения, а не только пара наборов', () => {
		const links = [price('Склад', true), price('Организация', true), price('Номенклатура')];
		const plate = rules.linkRequiredPlate(links);
		assert.ok(plate.startsWith('У связей №1 «Продажи → Цены» (Склад = Склад), №2 «Продажи → Цены» (Организация = Организация) '), plate);
		assert.ok(!plate.includes('№3'), 'связь без флажка в плашке');
		assert.ok(plate.includes(rules.LINK_REQUIRED_REASON));
		assert.equal(rules.linkRequiredPlate([price('Склад')]), '', 'без записанных флажков плашки нет');
		assert.ok(rules.linkRequiredPlate([price('Склад', true)]).startsWith('У связи №1 '));
		assert.notEqual(rules.linkLabel(links[0], 0), rules.linkLabel(links[1], 1));
	});

	test('подключение: таблица без колонки «Обязательная», с плашкой и пометкой строки; окно — через правила', () => {
		assert.ok(!renderLinks.includes("'Обязательная'"), 'в таблице колонка «Обязательная»');
		assert.ok(renderLinks.includes('linkRequiredPlate(links)'), 'плашка не строится');
		assert.ok(renderLinks.includes('if (linkRequiredOffered(link)) {'), 'строка с флажком не помечена');
		assert.ok(dialog.includes('linkRequiredOffered(link) ?'), 'флажок в окне строится не по правилу');
		assert.ok(dialog.includes('linkRequiredChange(link,'), 'payload правки собирается не по правилу');
		assert.ok(dialog.includes("setAttribute('aria-describedby'"), 'причина не связана с флажком для экранного диктора');
		const add = between(dialog, 'if (!link) {', "send('dcs/add-link'");
		assert.ok(!add.includes('required'), 'payload новой связи несёт required');
	});

	test('снимок: md-sparrow отказывает в required=true', () => {
		assert.equal(REFUSALS.linkRequiredRefused, true);
	});

	test('снимок совпадает с исходником md-sparrow: отказ required=true (если исходник рядом)', (t) => {
		const file = mdSparrowFile(path.join(JAVA_CF, 'DcsEdit.java'));
		if (!file) {
			skipWithoutSource(t, 'DcsEdit.java');
			return;
		}
		assert.equal(read(file).includes('LINK_REQUIRED_REFUSAL'), REFUSALS.linkRequiredRefused, 'окно и писатель разошлись');
	});
});

interface ListFlagRules {
	LINK_LIST_FLAG_REASON: string;
	linkParameterSet(parameter: unknown): boolean;
	linkListFlagLegacy(link: Record<string, unknown> | null): boolean;
	linkListFlagOffered(link: Record<string, unknown> | null, parameter: string): boolean;
	linkListFlagNew(checked: boolean, parameter: string): true | undefined;
	linkListFlagChange(link: Record<string, unknown>, parameter: string, checked: boolean, edited: boolean): boolean | null | undefined;
	linkListFlagPlate(links: Array<Record<string, unknown>>): string;
	linkListFlagWarningLine(warning: Record<string, unknown> | null, links: Array<Record<string, unknown>>): string;
}

/** Параметры JVM для живого jar: без них на Windows кириллица в путях и выводе идёт в системной кодировке. */
const JAR_ENCODING = ['file', 'sun.jnu', 'stdout', 'stderr', 'sun.stdout', 'sun.stderr'].map((key) => `-D${key}.encoding=UTF-8`);

interface JarCall {
	status: number | null;
	out: string;
	err: string;
}

/** Вызов живого md-sparrow без проверки кода выхода: параметры — файлом в work. */
function callJar(jar: string, work: string, command: string, params: Record<string, unknown>): JarCall {
	const paramsFile = path.join(work, 'params.json');
	fs.writeFileSync(paramsFile, JSON.stringify(params), 'utf8');
	const result = spawnSync(javaForJar(), [...JAR_ENCODING, '-jar', jar, command, '--params', paramsFile], {
		encoding: 'buffer',
		timeout: 120000,
		maxBuffer: 1 << 26,
	});
	return {
		status: result.status,
		out: result.stdout ? result.stdout.toString('utf8') : '',
		err: result.stderr ? result.stderr.toString('utf8') : '',
	};
}

/** Вызов живого md-sparrow: ответ — stdout (код выхода не 0 — сбой теста). */
function runJar(jar: string, work: string, command: string, params: Record<string, unknown>): string {
	const result = callJar(jar, work, command, params);
	assert.equal(result.status, 0, `${command} ${String(params.op)}: ${result.err}${result.out}`);
	return result.out;
}

/** Вызов живого md-sparrow в своём процессе (для параллельных проверок): код выхода и вывод. */
function callJarAsync(jar: string, paramsFile: string, command: string, params: Record<string, unknown>): Promise<JarCall> {
	fs.writeFileSync(paramsFile, JSON.stringify(params), 'utf8');
	return new Promise((resolve) => {
		const child = spawn(javaForJar(), [...JAR_ENCODING, '-jar', jar, command, '--params', paramsFile]);
		const out: Buffer[] = [];
		const err: Buffer[] = [];
		child.stdout.on('data', (chunk: Buffer) => out.push(chunk));
		child.stderr.on('data', (chunk: Buffer) => err.push(chunk));
		child.on('error', (error) => resolve({ status: null, out: '', err: String(error) }));
		child.on('close', (status) => resolve({ status, out: Buffer.concat(out).toString('utf8'), err: Buffer.concat(err).toString('utf8') }));
	});
}

/** Задачи по очереди в limit потоков: jar стартует JVM на каждый вызов, параллельно — в разы быстрее. */
async function inPool<T>(tasks: Array<() => Promise<T>>, limit: number): Promise<T[]> {
	const results: T[] = new Array<T>(tasks.length);
	let next = 0;
	const worker = async (): Promise<void> => {
		while (next < tasks.length) {
			const at = next;
			next += 1;
			results[at] = await tasks[at]();
		}
	};
	await Promise.all(Array.from({ length: Math.max(1, Math.min(limit, tasks.length)) }, worker));
	return results;
}

/** Потоков для живого jar: не больше шести и не больше ядер. */
const JAR_POOL = Math.max(1, Math.min(6, os.cpus().length));

/** Флаг связи, вписанный в файл вручную, как его пишет другая программа: после выражения приёмника связи index. */
function patchLink(file: string, index: number, insert: string): void {
	const text = fs.readFileSync(file, 'utf8');
	const eol = text.includes('\r\n') ? '\r\n' : '\n';
	let seen = -1;
	const patched = text.replace(/(<dataSetLink>[\s\S]*?<destinationExpression>[^<]*<\/destinationExpression>)/g, (block) => {
		seen += 1;
		return seen === index ? `${block}${eol}\t\t${insert}` : block;
	});
	assert.ok(seen >= index, `в файле нет связи ${index}`);
	fs.writeFileSync(file, patched, 'utf8');
}

describe('Связи наборов: флажок «Список параметров» (parameterListAllowed)', () => {
	// Флажок хранится только вместе с параметром связи: у связи без параметра загрузка отбрасывает и «да», и «нет», у связи с
	// параметром без флажка дописывает явное «нет» (ibcmd 8.3.27). «Нет» у связи с
	// параметром пишет сам md-sparrow; «да» без параметра он отклоняет. Поэтому окно без параметра флажок гасит и true не
	// шлёт никогда; записанный флаг без параметра убирает null; старое «да» без параметра показывает только чтобы снять.
	const rules = load<ListFlagRules>('const LINK_REQUIRED_REASON =', 'function renderLinks(', [
		'LINK_LIST_FLAG_REASON',
		'linkParameterSet',
		'linkListFlagLegacy',
		'linkListFlagOffered',
		'linkListFlagNew',
		'linkListFlagChange',
		'linkListFlagPlate',
		'linkListFlagWarningLine',
	]);
	const renderLinks = between(SCRIPT, 'function renderLinks(', 'function openLinkDialog(');
	const dialog = between(SCRIPT, 'function openLinkDialog(', '// ---------- вкладка «Вычисляемые поля»');
	const link = (parameter?: string, flag?: boolean): Record<string, unknown> => ({
		source: 'ВнешняяТаблица',
		destination: 'ОсновнойЗапрос',
		sourceExpression: 'Идентификатор',
		destinationExpression: 'ИдентификаторПроверки',
		...(parameter === undefined ? {} : { parameter }),
		...(flag === undefined ? {} : { parameterListAllowed: flag }),
	});

	test('флажок доступен только с параметром; без параметра — лишь у старого «да», чтобы снять', () => {
		assert.equal(rules.linkListFlagOffered(null, ''), false, 'новая связь без параметра');
		assert.equal(rules.linkListFlagOffered(null, 'Организация'), true);
		assert.equal(rules.linkListFlagOffered(null, '   '), false, 'параметр из пробелов — не параметр');
		assert.equal(rules.linkListFlagOffered(link('Организация', true), ''), false, 'параметр стёрли — флажок гаснет');
		assert.equal(rules.linkListFlagOffered(link(), ''), false);
		assert.equal(rules.linkListFlagOffered(link('', false), ''), false, '«нет» без параметра не предлагается');
		assert.equal(rules.linkListFlagOffered(link('', true), ''), true, 'старое «да» без параметра — снять');
		assert.equal(rules.linkListFlagOffered(link(undefined, true), 'Склад'), true);
		assert.equal(rules.linkListFlagLegacy(link(undefined, true)), true);
		assert.equal(rules.linkListFlagLegacy(link(' ', true)), true, 'пустой параметр из пробелов');
		assert.equal(rules.linkListFlagLegacy(link('Склад', true)), false);
		assert.equal(rules.linkListFlagLegacy(link(undefined, false)), false, '«нет» без параметра смысла не меняет');
		assert.equal(rules.linkListFlagLegacy(null), false);
	});

	test('новая связь: уходит только отмеченный флажок и только с параметром', () => {
		assert.equal(rules.linkListFlagNew(true, 'Организация'), true);
		assert.equal(rules.linkListFlagNew(false, 'Организация'), undefined, 'снятый флажок новая связь не шлёт: «нет» допишет md-sparrow');
		assert.equal(rules.linkListFlagNew(true, ''), undefined, 'без параметра true не уходит никогда');
		assert.equal(rules.linkListFlagNew(true, '  '), undefined);
		assert.equal(rules.linkListFlagNew(false, ''), undefined);
	});

	test('правка с параметром: «не задано» и «нет» — одно значение; отмеченный — true, снятый «да» — false', () => {
		assert.equal(rules.linkListFlagChange(link('Организация'), 'Организация', false, false), undefined, 'старая связь без флага: «нет» md-sparrow допишет сам');
		assert.equal(rules.linkListFlagChange(link('Организация', false), 'Организация', false, true), undefined, 'записанное «нет»');
		assert.equal(rules.linkListFlagChange(link('Организация', true), 'Организация', true, true), undefined);
		assert.equal(rules.linkListFlagChange(link('Организация'), 'Организация', true, false), true);
		assert.equal(rules.linkListFlagChange(link('Организация', true), 'Организация', false, false), false, 'у связи с параметром — «нет»');
		assert.equal(rules.linkListFlagChange(link(), 'Организация', false, true), undefined, 'параметр задали — «нет» допишет md-sparrow');
		assert.equal(rules.linkListFlagChange(link(), 'Организация', true, true), true, 'параметр задали и флажок отметили');
		assert.equal(rules.linkListFlagChange(link(undefined, true), 'Склад', true, true), undefined, 'старому «да» задали параметр — «да» остаётся');
		assert.equal(rules.linkListFlagChange(link(undefined, true), 'Склад', false, true), false);
	});

	test('правка без параметра: true не уходит никогда; записанный флаг убирается null', () => {
		// флага нет — убирать нечего, отмеченный флажок без параметра не уходит
		assert.equal(rules.linkListFlagChange(link(), '', false, false), undefined, 'связь без параметра и флага');
		assert.equal(rules.linkListFlagChange(link(), '', true, true), undefined, 'true без параметра окно не шлёт');
		assert.equal(rules.linkListFlagChange(link('Организация'), '', false, true), undefined, 'параметр сняли, флага нет');
		// параметр сняли — флаг (любой) уходит вместе с ним, даже если флажок остался отмечен
		assert.equal(rules.linkListFlagChange(link('Организация', false), '', false, true), null, '«нет» не остаётся без параметра');
		assert.equal(rules.linkListFlagChange(link('Организация', true), '', false, true), null, 'параметр и флажок сняты разом');
		assert.equal(rules.linkListFlagChange(link('Организация', true), '', true, true), null, '«да» без параметра не остаётся');
		// старое «да» без параметра: только снять; не тронутое — остаётся, в том числе при правке других свойств
		assert.equal(rules.linkListFlagChange(link('', true), '', false, false), null, 'снять старое «да»');
		assert.equal(rules.linkListFlagChange(link(undefined, true), '', true, false), undefined, 'окно без правок файл не меняет');
		assert.equal(rules.linkListFlagChange(link(undefined, true), '', true, true), undefined, 'правка других свойств «да» молча не снимает');
		// старое «нет» без параметра: смысла не меняет, убирается вместе с настоящей правкой
		assert.equal(rules.linkListFlagChange(link('', false), '', false, false), undefined, 'окно без правок файл не меняет');
		assert.equal(rules.linkListFlagChange(link(undefined, false), '', false, true), null, 'правка связи убирает «нет» без параметра');
	});

	test('плашка называет связи со старым «да» без параметра; «нет» и «да» с параметром — нет', () => {
		const links = [link(undefined, true), link('Склад', true), link(undefined, false), { ...link(' ', true), sourceExpression: 'Склад', destinationExpression: 'Склад' }];
		const plate = rules.linkListFlagPlate(links);
		assert.ok(plate.startsWith('У связей №1 «ВнешняяТаблица → ОсновнойЗапрос» (Идентификатор = ИдентификаторПроверки), №4 «ВнешняяТаблица → ОсновнойЗапрос» (Склад = Склад) флажок «Список параметров» записан без параметра: '), plate);
		assert.ok(plate.includes(rules.LINK_LIST_FLAG_REASON));
		assert.ok(plate.endsWith('Откройте связь (строка с пометкой «без параметра») и снимите флажок или задайте параметр.'), plate);
		assert.ok(!plate.includes('№2') && !plate.includes('№3'));
		assert.ok(rules.linkListFlagPlate([link(undefined, true)]).startsWith('У связи №1 '));
		assert.equal(rules.linkListFlagPlate([link('Склад', true), link(undefined, false), link()]), '', 'без старого «да» без параметра плашки нет');
	});

	test('плашка проверки называет связь номером таблицы (с единицы), а не номером md-sparrow (с нуля)', () => {
		// текст и ключ link md-sparrow считают связи с нуля, таблица связей и плашка над ней — с единицы
		const message = 'связь наборов ВнешняяТаблица → ОсновнойЗапрос (номер 1): флаг «Список параметров» записан без параметра связи';
		const links = [link('Склад', true), link(undefined, true), link(' ', false), link()];
		assert.equal(
			rules.linkListFlagWarningLine({ message, link: 1, kind: 'linkListFlagWithoutParameter' }, links),
			'Связь №2 «ВнешняяТаблица → ОсновнойЗапрос» (Идентификатор = ИдентификаторПроверки): флажок «Список параметров» («да») записан без параметра: ' +
				rules.LINK_LIST_FLAG_REASON +
				'.'
		);
		const no = rules.linkListFlagWarningLine({ message, link: 2, kind: 'linkListFlagWithoutParameter' }, links);
		assert.ok(no.startsWith('Связь №3 ') && no.includes('(«нет»)'), no);
		// связи нет в модели, номер не целый или модель с вердиктом расходится — текст md-sparrow как есть
		for (const index of [4, -1, 1.5, '1', undefined]) {
			assert.equal(rules.linkListFlagWarningLine({ message, link: index }, links), message, String(index));
		}
		assert.equal(rules.linkListFlagWarningLine({ message, link: 0 }, links), message, 'у связи задан параметр');
		assert.equal(rules.linkListFlagWarningLine({ message, link: 3 }, links), message, 'у связи нет флага');
		// значение флага в модели и в тексте md-sparrow должно совпасть, иначе — текст md-sparrow
		const saysTrue = message.replace('флаг «Список параметров»', 'флаг «Список параметров» (parameterListAllowed=true)');
		const saysFalse = saysTrue.replace('=true', '=false');
		assert.ok(rules.linkListFlagWarningLine({ message: saysTrue, link: 1 }, links).startsWith('Связь №2 '), 'модель и вердикт: «да»');
		assert.equal(rules.linkListFlagWarningLine({ message: saysFalse, link: 1 }, links), saysFalse, 'в модели «да», md-sparrow назвал false');
		assert.ok(rules.linkListFlagWarningLine({ message: saysFalse, link: 2 }, links).startsWith('Связь №3 '), 'модель и вердикт: «нет»');
		assert.equal(rules.linkListFlagWarningLine({ message: saysTrue, link: 2 }, links), saysTrue, 'в модели «нет», md-sparrow назвал true');
		assert.equal(rules.linkListFlagWarningLine({ link: 4 }, links), 'Предупреждение без описания');
		assert.equal(rules.linkListFlagWarningLine(null, links), 'Предупреждение без описания');
		const notice = between(SCRIPT, 'function validationNoticeLines(', 'const VALIDATION_LINK_LIST_FLAG_HINT');
		assert.ok(
			/if \(warning\.kind === 'linkListFlagWithoutParameter'\) \{[\s\S]*?linkListFlagWarningLine\(warning, list\('dataSetLinks'\)\)/.test(notice),
			'плашка проверки не называет связь номером таблицы'
		);
	});

	test('подключение: таблица, флажок и payload окна — через правила', () => {
		assert.ok(renderLinks.includes("cell(tr, link.parameterListAllowed ? '✓' : '', 'dcs-cell-check');"), 'таблица различает «не задано» и «нет»');
		assert.ok(renderLinks.includes('linkListFlagPlate(links)'), 'плашки о флажке без параметра нет');
		assert.ok(renderLinks.includes('if (linkListFlagLegacy(link)) {'), 'строка со старым «да» без параметра не помечена');
		assert.ok(between(SCRIPT, 'function checkbox(', 'function checkRow(').includes('input.checked = Boolean(checked);'), 'флажок различает «не задано» и «нет»');
		assert.ok(dialog.includes("checkbox('Список параметров', original.parameterListAllowed)"), 'окно строит флажок не из записанного значения');
		assert.ok(dialog.includes('linkListFlagOffered(link, parameterInput.value)'), 'доступность флажка не по правилу');
		assert.ok(dialog.includes("parameterInput.addEventListener('input', syncListBox)"), 'флажок не следит за полем «Параметр»');
		assert.ok(/listBox\.input\.disabled = !offered;/.test(dialog), 'флажок без параметра доступен');
		assert.ok(/if \(linkListFlagLegacy\(link\)\) \{[\s\S]*?listBox\.input\.setAttribute\('aria-describedby'/.test(dialog), 'причина у старого «да» не связана с флажком');
		const add = between(dialog, 'if (!link) {', "send('dcs/add-link'");
		assert.ok(add.includes('linkListFlagNew(listBox.input.checked, parameter)'), 'новая связь собирает флажок не по правилу');
		assert.equal((add.match(/parameterListAllowed/g) ?? []).length, 1, 'новая связь шлёт флажок мимо правила');
		const edit = between(dialog, "send('dcs/add-link'", "send('dcs/set-link'");
		assert.ok(edit.includes('linkListFlagChange(link, parameter, listBox.input.checked, Object.keys(payload).length > 0)'), 'правка собирает флажок не по правилу');
		assert.equal((edit.match(/parameterListAllowed/g) ?? []).length, 1, 'правка шлёт флажок мимо правила');
		// Признак «правка других свойств» считается по готовому payload: флажок — последним
		assert.ok(edit.indexOf('linkListFlagChange(') > edit.indexOf('payload.required = required;'), 'флажок считается раньше остальных свойств');
	});

	test('снимок: md-sparrow сам пишет «нет» у связи с параметром и отказывает в «да» без параметра', () => {
		assert.equal(REFUSALS.linkParameterListDefault, '<parameterListAllowed>false</parameterListAllowed>');
		assert.equal(REFUSALS.linkListFlagWithoutParameterRefused, true);
		assert.equal(REFUSALS.linkListFlagWithoutParameterKind, 'linkListFlagWithoutParameter');
	});

	test('снимок совпадает с исходником md-sparrow: «нет» у связи с параметром и отказ «да» без параметра (если исходник рядом)', (t) => {
		const file = mdSparrowFile(path.join(JAVA_CF, 'DcsEdit.java'));
		if (!file) {
			skipWithoutSource(t, 'DcsEdit.java');
			return;
		}
		const source = read(file);
		const constant = /\bString PARAMETER_LIST_DEFAULT\s*=\s*"([^"]*)"/.exec(source);
		assert.equal(constant?.[1], REFUSALS.linkParameterListDefault, 'md-sparrow не пишет «нет» у связи с параметром или пишет другое');
		// Константа нужна записи связи: новой (add-link) и правке (set-link), а не только описанию
		const uses = (source.match(/[^#\w]PARAMETER_LIST_DEFAULT\b(?!\s*=)/g) ?? []).length;
		assert.ok(uses >= 2, `запись связи не использует PARAMETER_LIST_DEFAULT (${uses})`);
		// Отказ «да» без параметра бросают и новая связь, и правка
		assert.equal(/\bString LINK_LIST_FLAG_REFUSAL\s*=/.test(source), REFUSALS.linkListFlagWithoutParameterRefused, 'окно и писатель разошлись');
		const throws = (source.match(/throw new IllegalArgumentException\(LINK_LIST_FLAG_REFUSAL\)/g) ?? []).length;
		assert.ok(throws >= 2, `отказ «да» без параметра бросается не в add-link и set-link (${throws})`);
		const flags = mdSparrowFile(path.join(JAVA_CF, 'DcsLegacyLinkListFlags.java'));
		assert.ok(flags, 'в исходнике md-sparrow нет DcsLegacyLinkListFlags.java');
		assert.ok(read(flags).includes(`KIND = "${REFUSALS.linkListFlagWithoutParameterKind}"`), 'вид предупреждения у md-sparrow другой');
		assert.ok(SCRIPT.includes(`warning.kind === '${REFUSALS.linkListFlagWithoutParameterKind}'`), 'плашка проверки ждёт другой вид');
	});

	test('живой md-sparrow: payload окна проходят, «да» без параметра — отказ, старая запись убирается окном (если задан MD_SPARROW_JAR)', (t) => {
		const jar = process.env.MD_SPARROW_JAR;
		if (!jar || !fs.existsSync(jar)) {
			t.diagnostic('флажок «Список параметров» не сверен с живым md-sparrow: задайте MD_SPARROW_JAR (и при нужде MD_SPARROW_JAVA)');
			t.skip('jar md-sparrow не задан');
			return;
		}
		const work = fs.mkdtempSync(path.join(os.tmpdir(), 'dcs-link-list-flag-'));
		try {
			const objectXml = path.join(work, 'Template.xml');
			fs.copyFileSync(path.join(FIXTURES, 'Template.xml'), objectXml);
			const links = (): Array<Record<string, unknown>> =>
				(JSON.parse(runJar(jar, work, 'read-json', { op: 'cf-dcs-info', objectXml, schemaVersion: 'V2_20' })) as { dataSetLinks: Array<Record<string, unknown>> }).dataSetLinks;
			const mutation = (op: string, payload: Record<string, unknown>, index?: number): Record<string, unknown> => ({
				objectXml,
				schemaVersion: 'V2_20',
				op,
				payloadJson: JSON.stringify(payload),
				...(index === undefined ? {} : { index }),
			});
			const mutate = (op: string, payload: Record<string, unknown>, index?: number): void => {
				runJar(jar, work, 'apply-mutation', mutation(op, payload, index));
			};
			/** Отказ md-sparrow: код 2 канала, файл не меняется, текст — об отказе флажка без параметра. */
			const refused = (op: string, payload: Record<string, unknown>, index?: number): void => {
				const before = fs.readFileSync(objectXml);
				const result = callJar(jar, work, 'apply-mutation', mutation(op, payload, index));
				assert.equal(result.status, 2, `${op} ${JSON.stringify(payload)}: ждали отказ, ${result.status}: ${result.err}${result.out}`);
				assert.match(result.err + result.out, /Флаг «Список параметров» связи наборов \(parameterListAllowed=true\) без параметра связи не записать/);
				assert.ok(fs.readFileSync(objectXml).equals(before), 'отказ изменил файл');
			};
			const unchanged = (op: string, payload: Record<string, unknown>, index: number): void => {
				const before = fs.readFileSync(objectXml);
				mutate(op, payload, index);
				assert.ok(fs.readFileSync(objectXml).equals(before), `${JSON.stringify(payload)} изменил файл`);
			};
			const added = { sourceDataSet: 'ВнешняяТаблица', destinationDataSet: 'ОсновнойЗапрос', sourceExpression: 'Идентификатор', destinationExpression: 'ИдентификаторПроверки' };
			const base = links().length;
			// Новая связь с параметром и снятым флажком: окно флажок не шлёт, md-sparrow пишет «нет» сразу после parameter
			assert.equal(rules.linkListFlagNew(false, 'Организация'), undefined);
			mutate('cf-dcs-add-link', { ...added, parameter: 'Организация' });
			assert.equal(links()[base].parameterListAllowed, false, 'md-sparrow не дописал «нет» у связи с параметром');
			assert.match(read(objectXml), /<parameter>Организация<\/parameter>\n\s*<parameterListAllowed>false<\/parameterListAllowed>/);
			// Новая связь без параметра с отмеченным флажком: окно флажок не шлёт; true мимо окна md-sparrow отклоняет
			assert.equal(rules.linkListFlagNew(true, ''), undefined);
			mutate('cf-dcs-add-link', { ...added });
			assert.equal(links()[base + 1].parameterListAllowed, undefined, 'у связи без параметра появился флаг');
			refused('cf-dcs-add-link', { ...added, parameterListAllowed: true });
			refused('cf-dcs-set-link', { parameterListAllowed: true }, base + 1);
			// Отметить «да» у связи с параметром и снять параметр: окно шлёт parameter '' и null — флаг уходит с параметром
			mutate('cf-dcs-set-link', { parameterListAllowed: rules.linkListFlagChange({ ...links()[base] }, 'Организация', true, false) }, base);
			assert.equal(links()[base].parameterListAllowed, true);
			const cleared = rules.linkListFlagChange({ ...links()[base] }, '', true, true);
			assert.equal(cleared, null, 'снятие параметра снимает и «да»');
			mutate('cf-dcs-set-link', { parameter: '', parameterListAllowed: cleared }, base);
			assert.equal(links()[base].parameter ?? '', '');
			assert.equal(links()[base].parameterListAllowed, undefined, 'после снятия параметра флаг остался без него');
			// Старая запись: «да» без параметра. Окно без правок ничего не шлёт; эхо и правка других свойств его не снимают;
			// снятый флажок — null, флаг уходит целиком
			patchLink(objectXml, base, '<parameterListAllowed>true</parameterListAllowed>');
			const legacy = { ...links()[base] };
			assert.equal(legacy.parameterListAllowed, true);
			assert.equal(rules.linkListFlagLegacy(legacy), true);
			assert.equal(rules.linkListFlagChange(legacy, '', true, false), undefined);
			unchanged('cf-dcs-set-link', { parameterListAllowed: true }, base);
			mutate('cf-dcs-set-link', { linkConditionExpression: 'Истина' }, base);
			assert.equal(links()[base].parameterListAllowed, true, 'правка условия молча сняла старое «да»');
			mutate('cf-dcs-set-link', { parameterListAllowed: rules.linkListFlagChange({ ...links()[base] }, '', false, false) }, base);
			assert.equal(links()[base].parameterListAllowed, undefined, 'снятое старое «да» осталось');
			// Старая запись: «нет» без параметра — уходит вместе с правкой условия
			patchLink(objectXml, base, '<parameterListAllowed>false</parameterListAllowed>');
			const flag = rules.linkListFlagChange({ ...links()[base] }, '', false, true);
			assert.equal(flag, null);
			mutate('cf-dcs-set-link', { linkConditionExpression: '', parameterListAllowed: flag }, base);
			assert.equal(links()[base].parameterListAllowed, undefined, '«нет» без параметра осталось');
			assert.ok(!/<parameterListAllowed>true<\/parameterListAllowed>/.test(read(objectXml)), 'в файле осталось «да»');
			// Строгая проверка: флаг без параметра (вписанный вручную) — предупреждение с номером связи
			patchLink(objectXml, base + 1, '<parameterListAllowed>true</parameterListAllowed>');
			const verdict = JSON.parse(runJar(jar, work, 'read-json', { op: 'cf-dcs-validate', objectXml, schemaVersion: 'V2_20', strict: true })) as {
				ok: boolean;
				warnings: Array<{ link?: number; kind?: string }>;
			};
			assert.equal(verdict.ok, true, 'предупреждение на ok не влияет');
			assert.deepEqual(
				verdict.warnings.filter((warning) => warning.kind === REFUSALS.linkListFlagWithoutParameterKind).map((warning) => warning.link),
				[base + 1]
			);
		} finally {
			fs.rmSync(work, { recursive: true, force: true });
		}
	});
});

interface ListRules {
	SCHEMA_LIST_NIL_WARNING: string;
	schemaListDropsNil(value: unknown): boolean;
	schemaListNilPlate(params: Array<Record<string, unknown>>): string;
	schemaListPresentedItems(value: unknown, valueListAllowed: unknown): unknown[];
	schemaListPresentationLoss(dropsNil: boolean, many: boolean): string;
	schemaListPresentationWarning(value: unknown, valueListAllowed: unknown, describe: (value: unknown) => string): string;
	schemaListPresentationPlate(params: Array<Record<string, unknown>>): string;
	schemaValueWarnings(param: Record<string, unknown>, describe: (value: unknown) => string): string[];
}

describe('Список значений параметра схемы', () => {
	const rules = load<ListRules>('function schemaListDropsNil(', 'function renderParameters(', [
		'SCHEMA_LIST_NIL_WARNING',
		'schemaListDropsNil',
		'schemaListNilPlate',
		'schemaListPresentedItems',
		'schemaListPresentationLoss',
		'schemaListPresentationWarning',
		'schemaListPresentationPlate',
		'schemaValueWarnings',
	]);
	const nil = { value: { nil: true } };
	const text = (value: string) => ({ value: { type: 'xs:string', text: value } });
	const listOf = (...items: unknown[]) => ({ type: 'v8:ValueListType', list: { items } });

	test('«Неопределено» рядом с другими значениями — предупреждение; одиночное и без него — нет', () => {
		assert.equal(rules.schemaListDropsNil(listOf(nil, text('A'))), true);
		assert.equal(rules.schemaListDropsNil(listOf(text('A'), nil)), true);
		assert.equal(rules.schemaListDropsNil(listOf(nil)), false, 'одиночный nil платформа хранит');
		assert.equal(rules.schemaListDropsNil(listOf(text('A'), text('B'))), false);
		assert.equal(rules.schemaListDropsNil(listOf()), false);
		assert.equal(rules.schemaListDropsNil({ nil: true }), false, 'значение не список');
		assert.equal(rules.schemaListDropsNil(undefined), false);
		const plate = rules.schemaListNilPlate([
			{ name: 'Буквы', valueTyped: listOf(nil, text('A')) },
			{ name: 'Одна', valueTyped: listOf(nil) },
		]);
		assert.equal(plate, 'У параметра «Буквы» в списке значений ' + rules.SCHEMA_LIST_NIL_WARNING);
		assert.equal(rules.schemaListNilPlate([{ name: 'Одна', valueTyped: listOf(nil) }]), '');
	});

	// Старая запись списка: элемент с представлением. Форма платформы (повторяющиеся value) читается без представлений
	const num = (value: number, presentation?: string) => ({
		value: { type: 'xs:decimal', text: String(value), decoded: value },
		...(presentation === undefined ? {} : { presentation }),
	});
	/** Сводка значения для теста: текст, «Неопределено» у nil — как valueSummary для простых значений. */
	const describeValue = (value: unknown): string => {
		const typed = value as { nil?: boolean; text?: string } | undefined;
		return typed?.nil ? 'Неопределено' : (typed?.text ?? '');
	};

	test('старая запись с представлениями — предупреждение; без представлений, форма платформы и без признака списка — нет', () => {
		assert.equal(rules.schemaListPresentedItems(listOf(num(10, 'десять'), num(20)), true).length, 1);
		assert.equal(rules.schemaListPresentedItems(listOf(num(10), num(20)), true).length, 0, 'без представлений загрузка развернёт без потерь');
		assert.equal(rules.schemaListPresentedItems(listOf(num(10, ''), num(20)), true).length, 0, 'пустое <v8:presentation/> — не представление');
		assert.equal(rules.schemaListPresentedItems(listOf(num(10, 'десять')), false).length, 0, 'без признака списка редактор о списке молчит');
		assert.equal(rules.schemaListPresentedItems(listOf(num(10, 'десять')), undefined).length, 0, 'признак не записан — умолчание false');
		assert.equal(rules.schemaListPresentedItems({ type: 'xs:decimal', text: '10' }, true).length, 0, 'значение не список');
		assert.equal(rules.schemaListPresentedItems({ list: { items: [num(10, 'десять')] } }, true).length, 0, 'без type v8:ValueListType — не значение параметра схемы');
		assert.equal(rules.schemaListPresentedItems(undefined, true).length, 0);
		assert.equal(rules.schemaListPresentedItems({ type: 'v8:ValueListType' }, true).length, 0, 'список без элементов');
		assert.equal(rules.schemaListPresentedItems({ type: 'v8:ValueListType', list: { items: [null, 7, num(1, 'один')] } }, true).length, 1, 'чужие элементы не роняют');
	});

	test('текст предупреждения: три первых элемента с представлениями, остальные числом; значения остаются', () => {
		assert.equal(rules.schemaListPresentationWarning(listOf(num(10)), true, describeValue), '');
		const one = rules.schemaListPresentationWarning(listOf(num(10, 'десять'), num(20)), true, describeValue);
		assert.equal(one, 'Список значений записан старой формой, с представлениями элементов (10: «десять»): ' + rules.schemaListPresentationLoss(false, false));
		assert.match(rules.schemaListPresentationLoss(false, false), /развернёт его в отдельные значения, а представления потеряет\. Значения останутся/);
		const many = rules.schemaListPresentationWarning(
			listOf(num(1, 'один'), num(2, 'два'), { value: { nil: true }, presentation: 'нет' }, num(4, 'четыре'), num(5, 'пять')),
			true,
			describeValue
		);
		assert.ok(many.startsWith('Список значений записан старой формой, с представлениями элементов (1: «один», 2: «два», Неопределено: «нет» и ещё 2): '), many);
		const empty = rules.schemaListPresentationWarning(listOf({ value: { type: 'xs:string', text: '' }, presentation: 'пусто' }), true, describeValue);
		assert.ok(empty.includes('(пустое: «пусто»)'), 'пустое значение подписано');
	});

	test('плашка называет параметры; ячейка собирает оба предупреждения списка', () => {
		const params = [
			{ name: 'Размер', valueListAllowed: true, valueTyped: listOf(num(10, 'десять')) },
			{ name: 'Без', valueListAllowed: true, valueTyped: listOf(num(10), num(20)) },
			{ name: 'Признака', valueTyped: listOf(num(10, 'десять')) },
			// форма платформы; представления доступных значений (availableValue) хранятся отдельно и правила не касаются
			{ name: 'Платформы', valueListAllowed: true, valueTyped: listOf(num(1), num(2)), hasAvailableValues: true },
		];
		assert.equal(
			rules.schemaListPresentationPlate(params),
			'Список значений параметра «Размер» записан старой формой, с представлениями элементов: ' + rules.schemaListPresentationLoss(false, false)
		);
		const two = rules.schemaListPresentationPlate([params[0], { name: 'Цвет', valueListAllowed: true, valueTyped: listOf(num(1, 'красный')) }]);
		assert.ok(two.startsWith('Списки значений параметров «Размер», «Цвет» записаны старой формой, с представлениями элементов: загрузка схемы в платформу развернёт их'), two);
		assert.ok(two.endsWith('в файле такие списки хранятся как есть.'), two);
		assert.equal(rules.schemaListPresentationPlate(params.slice(1)), '', 'без представлений, без признака и форма платформы — плашки нет');
		assert.deepEqual(rules.schemaValueWarnings(params[1], describeValue), []);
		assert.deepEqual(rules.schemaValueWarnings(params[0], describeValue), [rules.schemaListPresentationWarning(params[0].valueTyped, true, describeValue)]);
		const both = rules.schemaValueWarnings({ name: 'Оба', valueListAllowed: true, valueTyped: listOf(nil, num(1, 'один')) }, describeValue);
		assert.equal(both.length, 2, '«Неопределено» среди значений и представления — два предупреждения');
		assert.equal(both[0], rules.SCHEMA_LIST_NIL_WARNING);
	});

	test('при «Неопределено» среди значений предупреждение о представлениях не обещает, что останутся все значения', () => {
		// Соседнее предупреждение говорит, что загрузка отбросит «Неопределено»: «Значения останутся» ему бы противоречило
		const oba = { name: 'Оба', valueListAllowed: true, valueTyped: listOf({ value: { nil: true }, presentation: 'нет' }, num(1, 'один')) };
		const [nilWarning, presentations] = rules.schemaValueWarnings(oba, describeValue);
		assert.equal(nilWarning, rules.SCHEMA_LIST_NIL_WARNING);
		assert.match(nilWarning, /останутся только заданные значения/);
		assert.ok(presentations.endsWith('а представления потеряет. Заданные значения останутся; в файле такой список хранится как есть.'), presentations);
		assert.ok(!presentations.includes('. Значения останутся'), presentations);
		assert.equal(rules.schemaListPresentationLoss(true, false), rules.schemaListPresentationLoss(false, false).replace('Значения останутся', 'Заданные значения останутся'));
		// Плашка: один такой параметр — тоже «заданные»; без «Неопределено» — «Значения останутся»
		assert.ok(rules.schemaListPresentationPlate([oba]).endsWith(rules.schemaListPresentationLoss(true, false)));
		const plain = { name: 'Размер', valueListAllowed: true, valueTyped: listOf(num(10, 'десять')) };
		assert.ok(rules.schemaListPresentationPlate([plain]).endsWith(rules.schemaListPresentationLoss(false, false)));
		assert.ok(rules.schemaListPresentationPlate([plain, oba]).endsWith('Заданные значения останутся; в файле такие списки хранятся как есть.'));
		assert.ok(rules.schemaListPresentationPlate([plain, { ...plain, name: 'Цвет' }]).endsWith('. Значения останутся; в файле такие списки хранятся как есть.'));
	});

	test('подключение: плашка над таблицей, предупреждение в диалоге параметра и в окне типа', () => {
		const table = between(SCRIPT, 'function renderParameters(', 'function openParameterDialog(');
		assert.ok(table.includes('schemaListNilPlate(params)'));
		assert.ok(table.includes('schemaListPresentationPlate(params)'), 'нет плашки о представлениях');
		assert.ok(table.includes('schemaValueWarnings(param, valueSummary)'), 'ячейка значения не помечена');
		assert.ok(table.includes("valueTd.setAttribute('aria-description'"), 'пометка ячейки только в title');
		const dialog = between(SCRIPT, 'function openParameterDialog(', '// ---------- вкладка «Вложенные схемы»');
		assert.ok(dialog.includes('if (schemaListDropsNil(value)) {'), 'в диалоге параметра нет предупреждения');
		assert.ok(
			dialog.includes('schemaListPresentationWarning(value, original.valueListAllowed, valueSummary)'),
			'в диалоге параметра нет предупреждения о представлениях'
		);
		const typeWindow = between(
			SCRIPT,
			'// ---------- тип значения: колонка «Тип» и окно «Тип значения» ----------',
			'// ---------- вкладка «Наборы данных» ----------'
		);
		assert.ok(typeWindow.includes('if (schemaListDropsNil(value)) {'), 'в окне типа нет предупреждения');
		assert.ok(
			typeWindow.includes('schemaListPresentationWarning(value, parameter.valueListAllowed, valueSummary)'),
			'в окне типа нет предупреждения о представлениях'
		);
		assert.ok(typeWindow.includes('parameter: { value: param.valueTyped, valueListAllowed: param.valueListAllowed }'), 'окно типа не знает признака списка');
	});

	// Сверка с md-sparrow — по поведению: снимок его ответов на варианты старой записи (legacy-value-lists.json)
	// прогоняется правилом редактора всегда, а с MD_SPARROW_JAR снимок сверяется с живым jar. Текст исходника
	// Java поведения не доказывает: правило, переписанное в нём иначе, прошло бы любую проверку подстрок.
	const lostOf = (snapshot: LegacyListsSnapshot): string[] =>
		snapshot.validate.warnings.filter((warning) => warning.kind === 'valueListPresentationsLost').map((warning) => warning.parameter);
	const flaggedOf = (snapshot: LegacyListsSnapshot): string[] =>
		snapshot.info.parameters.filter((param) => rules.schemaListPresentedItems(param.valueTyped, param.valueListAllowed).length > 0).map((param) => param.name);

	test('снимок md-sparrow на вариантах старой записи: редактор помечает ровно параметры предупреждений строгой проверки', () => {
		assert.equal(LEGACY_LISTS.validate.ok, true, 'предупреждения на ok не влияют');
		assert.deepEqual(flaggedOf(LEGACY_LISTS), lostOf(LEGACY_LISTS), 'правило редактора и md-sparrow разошлись');
		// Предупреждение — с признаком списка и хотя бы одним непустым представлением, в том числе
		// у единственного элемента и рядом с «Неопределено»; без представлений, с пустым <v8:presentation/>, без
		// признака или с false, форма платформы и одно значение списка — без предупреждения
		assert.deepEqual(lostOf(LEGACY_LISTS), ['СПредставлением', 'Одиночный', 'Пять', 'НеопределеноИПредставление']);
		assert.deepEqual(
			LEGACY_LISTS.info.parameters.map((param) => param.name),
			[
				'СПредставлением',
				'Одиночный',
				'Пять',
				'НеопределеноИПредставление',
				'БезПредставлений',
				'ПустоеПредставление',
				'БезПризнака',
				'ПризнакЛожь',
				'ФормаПлатформы',
				'ОдноЗначениеСписка',
			]
		);
		// Без признака представления в ответе есть: молчание здесь — правило, а не отсутствие данных
		for (const name of ['БезПризнака', 'ПризнакЛожь']) {
			const param = LEGACY_LISTS.info.parameters.find((row) => row.name === name);
			assert.ok(JSON.stringify(param?.valueTyped).includes('"presentation":"десять"'), name);
			assert.notEqual(param?.valueListAllowed, true, name);
		}
		const plate = rules.schemaListPresentationPlate(LEGACY_LISTS.info.parameters as Array<Record<string, unknown>>);
		for (const param of LEGACY_LISTS.info.parameters) {
			assert.equal(plate.includes(`«${param.name}»`), lostOf(LEGACY_LISTS).includes(param.name), `плашка: ${param.name}`);
		}
	});

	test('снимок снят с этой фикстуры: хеш текста и состав параметров', () => {
		const xml = read(path.join(FIXTURES, LEGACY_LISTS.template));
		assert.equal(createHash('sha256').update(xml, 'utf8').digest('hex'), LEGACY_LISTS.templateSha256, 'фикстура менялась без пересборки снимка (legacy-value-lists.mjs)');
		const names = [...xml.matchAll(/<parameter>\s*<name>([^<]+)<\/name>/g)].map((match) => match[1]);
		assert.deepEqual(names, LEGACY_LISTS.info.parameters.map((param) => param.name));
	});

	test('снимок совпадает с живым md-sparrow (если задан MD_SPARROW_JAR)', (t) => {
		const jar = process.env.MD_SPARROW_JAR;
		if (!jar || !fs.existsSync(jar)) {
			t.diagnostic('снимок legacy-value-lists.json не сверен с живым md-sparrow: задайте MD_SPARROW_JAR (и при нужде MD_SPARROW_JAVA)');
			t.skip('jar md-sparrow не задан');
			return;
		}
		const result = spawnSync(process.execPath, [path.join(FIXTURES, 'legacy-value-lists.mjs'), '--jar', jar, '--java', javaForJar(), '--check'], {
			encoding: 'utf8',
			timeout: 180000,
		});
		assert.equal(result.status, 0, `${result.stdout ?? ''}${result.stderr ?? ''}`);
		t.diagnostic((result.stdout ?? '').trim());
	});

	test('вид предупреждения тот же, что в исходнике md-sparrow (если исходник рядом)', (t) => {
		assert.ok(SCRIPT.includes("warning.kind === 'valueListPresentationsLost'"), 'плашка проверки ждёт другой вид');
		const file = mdSparrowFile(path.join(JAVA_CF, 'DcsLegacyValueLists.java'));
		if (!file) {
			t.diagnostic('вид предупреждения не сверен с DcsLegacyValueLists.java: задайте MD_SPARROW_SRC');
			t.skip('исходника md-sparrow рядом нет');
			return;
		}
		assert.ok(read(file).includes('KIND = "valueListPresentationsLost"'), 'вид предупреждения у md-sparrow другой');
	});

	test('предупреждение о представлениях только показывается: окна значение параметра схемы не шлют', () => {
		// Старую запись редактор не переписывает, а предупреждает: ни одна функция правила не строит правку
		const section = between(SCRIPT, 'function schemaListPresentedItems(', 'function renderParameters(');
		assert.ok(!section.includes('send('), 'правило шлёт правку');
		assert.ok(!section.includes('post('), 'правило шлёт сообщение');
	});

	test('значение параметра схемы окна не правят: только показ, запись — лишь очисткой при смене типа', () => {
		const dialog = between(SCRIPT, 'function openParameterDialog(', '// ---------- вкладка «Вложенные схемы»');
		assert.ok(!dialog.includes('createValueControl('), 'в диалоге параметра появился редактор значения');
		assert.ok(dialog.includes("el('span', 'dcs-type-value'"), 'значение в диалоге параметра не только показывается');
		const typeWindow = between(
			SCRIPT,
			'// ---------- тип значения: колонка «Тип» и окно «Тип значения» ----------',
			'// ---------- вкладка «Наборы данных» ----------'
		);
		assert.ok(!typeWindow.includes('createValueControl('), 'в окне типа появился редактор значения');
	});

	test('редактор списка с представлениями и строкой «Неопределено» — только у значений варианта', () => {
		// Платформа хранит список параметра схемы без представлений, а nil — только единственным элементом;
		// общий редактор значения (поле представления, режим «Неопределено» в строке списка) живёт в отборе,
		// параметрах данных и вывода варианта и в оформлении — формат v8:ValueListType, другая форма записи.
		const callers = new Set<string>();
		let at = SCRIPT.indexOf('createValueControl(');
		while (at >= 0) {
			const enclosing = [...SCRIPT.slice(0, at).matchAll(/\n\tfunction (\w+)\(/g)].pop();
			if (!SCRIPT.startsWith('function createValueControl(', at - 'function '.length)) {
				callers.add(enclosing ? enclosing[1] : '?');
			}
			at = SCRIPT.indexOf('createValueControl(', at + 1);
		}
		assert.deepEqual([...callers].sort(), ['buildComparisonForm', 'caAppearanceEditor', 'createValueControl', 'openParamValueDialog']);
	});
});

interface NoticeLine {
	text: string;
	hint?: boolean;
}

interface ValidationNotice {
	validationNoticeLines(msg: Record<string, unknown>): NoticeLine[];
	validationNoticeTone(msg: Record<string, unknown>): string;
	setLinks(links: Array<Record<string, unknown>>): void;
}

describe('Плашка «Проверка схемы»: предупреждения строгой проверки', () => {
	// Связь в предупреждении о флажке без параметра плашка называет номером таблицы: нужны правила связей и модель (list)
	const notice = load<ValidationNotice>(
		'function validationNoticeLines(',
		"validateBtn.addEventListener('click'",
		['validationNoticeLines', 'validationNoticeTone', 'setLinks'],
		between(SCRIPT, 'const LINK_REQUIRED_REASON =', 'function renderLinks(') +
			"\nlet testLinks = [];\nfunction list(key) { return key === 'dataSetLinks' ? testLinks : []; }\nfunction setLinks(links) { testLinks = links; }\n"
	);
	const LOST =
		'параметр схемы Размер: список значений записан старой формой v8:ValueListType с представлениями элементов (10: «десять»); при загрузке платформа развернёт его в отдельные значения, а представления потеряет; уберите представления или оставьте список как есть, если их потеря не важна';
	const UNDECLARED = 'параметр запроса &Склад не объявлен в схеме (набор данных Остатки)';

	test('без предупреждений: «Ошибок нет.» зелёным, ошибки с позициями красным', () => {
		assert.deepEqual(notice.validationNoticeLines({ ok: true, errors: [], warnings: [] }), [{ text: 'Ошибок нет.' }]);
		assert.equal(notice.validationNoticeTone({ ok: true, errors: [], warnings: [] }), 'ok');
		assert.deepEqual(notice.validationNoticeLines({ ok: false, errors: [{ message: 'корень', line: 3, column: 14 }], warnings: [] }), [{ text: '3:14: корень' }]);
		assert.equal(notice.validationNoticeTone({ ok: false, errors: [], warnings: [] }), 'error');
	});

	test('предупреждения идут после итога текстом md-sparrow; у списка старой записи — подсказка про вкладку «Параметры»', () => {
		const msg = {
			ok: true,
			errors: [],
			warnings: [
				{ message: UNDECLARED, parameter: 'Склад', dataSet: 'Остатки', kind: 'undeclaredQueryParameter' },
				{ message: LOST, parameter: 'Размер', kind: 'valueListPresentationsLost' },
			],
		};
		const lines = notice.validationNoticeLines(msg);
		assert.deepEqual(lines.slice(0, 4), [{ text: 'Ошибок нет.' }, { text: 'Предупреждения (2):' }, { text: UNDECLARED }, { text: LOST }]);
		assert.equal(lines.length, 5);
		assert.equal(lines[4].hint, true);
		assert.equal(notice.validationNoticeTone(msg), 'info', 'ошибок нет, но есть о чём сказать — не зелёная плашка');
	});

	test('подсказка к списку старой записи говорит, чем убрать представления: не окнами и не снятием флажка, а записью списка заново', () => {
		// Совет md-sparrow «уберите представления» окнами не выполнить: значение параметра схемы они не правят
		const lines = notice.validationNoticeLines({ ok: true, errors: [], warnings: [{ message: LOST, parameter: 'Размер', kind: 'valueListPresentationsLost' }] });
		const hint = lines[lines.length - 1];
		assert.equal(hint?.hint, true);
		assert.equal(
			hint?.text,
			'Такие списки помечены и на вкладке «Параметры». Ни окна правки, ни снятие флажка «Доступен список значений» представления не убирают: убрать их можно только записью списка заново без представлений.'
		);
	});

	test('флажок «Список параметров» без параметра: текст md-sparrow и подсказка, где такие связи помечены и как убрать «нет»', () => {
		const flag =
			'связь наборов ВнешняяТаблица → ОсновнойЗапрос (номер 1): флаг «Список параметров» (parameterListAllowed=true) записан без параметра связи; при загрузке платформа его отбросит. Задайте parameter или снимите флаг';
		const msg = { ok: true, errors: [], warnings: [{ message: flag, link: 1, kind: 'linkListFlagWithoutParameter' }] };
		const lines = notice.validationNoticeLines(msg);
		assert.deepEqual(lines.slice(0, 3), [{ text: 'Ошибок нет.' }, { text: 'Предупреждения (1):' }, { text: flag }]);
		assert.equal(lines.length, 4);
		assert.equal(lines[3].hint, true);
		assert.match(lines[3].text, /помечены на вкладке «Связи наборов данных»: откройте связь и снимите флажок или задайте параметр/);
		assert.match(lines[3].text, /«Нет» без параметра смысла связи не меняет; окно связи убирает его вместе с любой правкой этой связи\./);
		assert.equal(notice.validationNoticeTone(msg), 'info');
		// Вместе со списком старой записи — обе подсказки, каждая один раз
		const both = notice.validationNoticeLines({ ok: true, errors: [], warnings: [msg.warnings[0], { message: LOST, parameter: 'Размер', kind: 'valueListPresentationsLost' }, msg.warnings[0]] });
		assert.equal(both.filter((line) => line.hint).length, 2);
		// Связь есть в прочитанной модели — она названа номером таблицы (с единицы), как в плашке над таблицей связей
		try {
			notice.setLinks([
				{ source: 'А', destination: 'Б', sourceExpression: 'Склад', destinationExpression: 'Склад', parameter: 'Склад' },
				{ source: 'ВнешняяТаблица', destination: 'ОсновнойЗапрос', sourceExpression: 'Идентификатор', destinationExpression: 'ИдентификаторПроверки', parameterListAllowed: true },
			]);
			const named = notice.validationNoticeLines(msg);
			assert.equal(named[2].text.startsWith('Связь №2 «ВнешняяТаблица → ОсновнойЗапрос» (Идентификатор = ИдентификаторПроверки): флажок «Список параметров» («да») записан без параметра'), true, named[2].text);
			assert.ok(!named[2].text.includes('номер 1'), 'номер md-sparrow (с нуля) не показывается');
			assert.equal(named.length, 4);
		} finally {
			notice.setLinks([]);
		}
	});

	test('предупреждение другого вида и без текста — показывается, подсказок о списках и связях нет', () => {
		const lines = notice.validationNoticeLines({ ok: false, errors: [], warnings: [{ message: UNDECLARED, kind: 'undeclaredQueryParameter' }, {}] });
		assert.deepEqual(lines, [
			{ text: 'Схема не прошла проверку, но ошибки валидатор не назвал.' },
			{ text: 'Предупреждения (2):' },
			{ text: UNDECLARED },
			{ text: 'Предупреждение без описания' },
		]);
	});

	test('плашка — внутри живой области: показ итога проверки озвучивает экранный диктор', () => {
		// Сама плашка скрывается display: none и при этом выпадает из дерева доступности — живой областью
		// служит постоянная обёртка, иначе первый показ плашки диктор бы пропустил
		const html = read(path.join(WEBVIEW, 'dcs-editor.html'));
		assert.match(html, /<div id="noticeLive" role="status" aria-live="polite"><div id="notice" class="dcs-notice hidden"><\/div><\/div>/);
		const css = read(path.join(WEBVIEW, 'dcs-editor.css'));
		assert.ok(!/#noticeLive[^{]*\{[^}]*display:\s*none/.test(css), 'живая область скрыта');
		assert.ok(SCRIPT.includes("const noticeEl = document.getElementById('notice');"), 'плашка ищется не по id');
	});

	test('подключение: ответ validation показывается через тон и строки проверки, хост передаёт warnings', () => {
		assert.ok(SCRIPT.includes("showNotice(validationNoticeTone(msg), 'Проверка схемы', validationNoticeLines(msg));"));
		const panel = read(path.join(ROOT, 'src', 'features', 'metadata', 'dcsEditorPanel.ts'));
		assert.ok(panel.includes("post({ type: 'validation', ok: verdict.ok, errors: verdict.errors, warnings: verdict.warnings });"), 'хост не передаёт предупреждения');
	});
});

interface PathStep {
	list: string;
	index: number;
}

interface OutputDictEntry {
	control: string;
	type: string;
	options: Array<{ value: string; label: string }>;
	defaultValue?: string;
	kinds?: string[];
}

interface OutputLevels {
	OUTPUT_PARAMS: Record<string, OutputDictEntry>;
	OUTPUT_PARAMS_NOT_STORED: Record<string, string[]>;
	outputLevelOf(node: unknown, path: PathStep[]): string;
	outputNotStored(name: string, level: string): boolean;
	outputAddable(kind: string, level: string, records: Array<{ parameter?: string }>): string[];
	outputNotStoredReason(level: string): string;
	outputUseLabel(name: string): string;
	outputUnkeptQuestion(name: string, level: string): string;
}

/**
 * Имена в Set.of(...) константы Java: тот же разбор, что у самопроверки roundtrip.py. Имя константы — с границы слова:
 * GROUP_FORBIDDEN_OUTPUT_PARAMETERS — хвост TABLE_GROUP_ и CHART_GROUP_FORBIDDEN_OUTPUT_PARAMETERS.
 */
function javaSet(java: string, constant: string): string[] {
	const match = new RegExp(`\\b${constant}\\s*=\\s*Set\\.of\\(([^;]*?)\\);`).exec(java);
	assert.ok(match, `в DcsSettingsEdit.java нет ${constant} = Set.of(...)`);
	return [...match[1].matchAll(/"([^"]+)"/g)].map((item) => item[1]);
}

/** Уровни окна (outputLevelOf), ключи снимка md-sparrow-refusals.json и константы DcsSettingsEdit.java. */
const OUTPUT_LEVELS: Array<{ level: string; snapshot: keyof Refusals; constant: string }> = [
	{ level: 'root', snapshot: 'rootForbiddenOutputParameters', constant: 'ROOT_FORBIDDEN_OUTPUT_PARAMETERS' },
	{ level: 'group', snapshot: 'groupForbiddenOutputParameters', constant: 'GROUP_FORBIDDEN_OUTPUT_PARAMETERS' },
	{ level: 'table', snapshot: 'tableForbiddenOutputParameters', constant: 'TABLE_FORBIDDEN_OUTPUT_PARAMETERS' },
	{ level: 'tableGroup', snapshot: 'tableGroupForbiddenOutputParameters', constant: 'TABLE_GROUP_FORBIDDEN_OUTPUT_PARAMETERS' },
	{ level: 'chart', snapshot: 'chartForbiddenOutputParameters', constant: 'CHART_FORBIDDEN_OUTPUT_PARAMETERS' },
	{ level: 'chartGroup', snapshot: 'chartGroupForbiddenOutputParameters', constant: 'CHART_GROUP_FORBIDDEN_OUTPUT_PARAMETERS' },
];

/** Список запрета уровня из снимка. */
const snapshotList = (key: keyof Refusals): string[] => REFUSALS[key] as string[];

describe('Параметры вывода: уровни, где платформа их не хранит', () => {
	// Словарь «Других настроек» исполняется вместе с правилами; список типов диаграммы (из мастера) тут не нужен
	const levels = load<OutputLevels>(
		'/** Расположение итогов DataCompositionTotalPlacement',
		'/** Значение словарного параметра правится',
		[
			'OUTPUT_PARAMS',
			'OUTPUT_PARAMS_NOT_STORED',
			'outputLevelOf',
			'outputNotStored',
			'outputAddable',
			'outputNotStoredReason',
			'outputUseLabel',
			'outputUnkeptQuestion',
		],
		'const wizardRules = { CHART_TYPES: [] };\n'
	);
	const outputParams = between(SCRIPT, 'const OUTPUT_PARAMS = {', '\n\t};');
	const dictionary = [...outputParams.matchAll(/^\t\t'([^']+)': \{/gm)].map((match) => match[1]);

	test('списки окна совпадают со снимком отказов md-sparrow на всех шести уровнях; все имена — из словаря «Других настроек»', () => {
		assert.deepEqual(
			Object.keys(levels.OUTPUT_PARAMS_NOT_STORED).sort(),
			OUTPUT_LEVELS.map((entry) => entry.level).sort(),
			'уровни окна и снимка разошлись'
		);
		for (const { level, snapshot } of OUTPUT_LEVELS) {
			assert.deepEqual(sorted(levels.OUTPUT_PARAMS_NOT_STORED[level]), sorted(snapshotList(snapshot)), level);
			assert.equal(new Set(levels.OUTPUT_PARAMS_NOT_STORED[level]).size, levels.OUTPUT_PARAMS_NOT_STORED[level].length, `${level}: повтор имени`);
			for (const name of levels.OUTPUT_PARAMS_NOT_STORED[level]) {
				assert.ok(dictionary.includes(name), `${level}: ${name} нет в словаре OUTPUT_PARAMS`);
			}
		}
		assert.equal(dictionary.length, 22, 'словарь — 22 имени таблицы рангов');
	});

	test('хранимое на уровне — ответ загрузки в платформу: у диаграммы три параметра, у её групп два, у таблицы двенадцать', () => {
		const kept = (level: string): string[] => sorted(dictionary.filter((name) => !levels.outputNotStored(name, level)));
		assert.deepEqual(kept('chart'), sorted(['ТипДиаграммы', 'ВыводитьЗаголовок', 'Заголовок']));
		assert.deepEqual(kept('chartGroup'), sorted(['КоличествоЗаписей', 'ПроцентЗаписей']));
		assert.deepEqual(
			kept('table'),
			sorted([
				'МакетОформления',
				'РасположениеИтогов',
				'РасположениеПолейГруппировки',
				'РасположениеГруппировки',
				'РасположениеРеквизитов',
				'РасположениеРесурсов',
				'ГоризонтальноеРасположениеОбщихИтогов',
				'ВертикальноеРасположениеОбщихИтогов',
				'ТипЗаголовкаПолей',
				'ВыводитьЗаголовок',
				'Заголовок',
				'АвтоПозицияРесурсов',
			])
		);
		assert.equal(kept('tableGroup').length, 15);
		assert.equal(kept('group').length, 17);
		assert.equal(kept('root').length, 17);
		// Каждое имя словаря хранится хотя бы на одном уровне: запрет нигде не «всё»
		for (const name of dictionary) {
			assert.ok(OUTPUT_LEVELS.some(({ level }) => !levels.outputNotStored(name, level)), `${name} не хранится нигде`);
		}
	});

	test('снимок совпадает с исходником md-sparrow: списки и охват (если исходник рядом)', (t) => {
		const file = mdSparrowFile(path.join(JAVA_CF, 'DcsSettingsEdit.java'));
		if (!file) {
			skipWithoutSource(t, 'DcsSettingsEdit.java');
			return;
		}
		const java = read(file);
		for (const { snapshot, constant } of OUTPUT_LEVELS) {
			assert.deepEqual(sorted(snapshotList(snapshot)), sorted(javaSet(java, constant)), constant);
		}
		// Охват тот же: группировка структуры — узел вида группы, до которого путь идёт только шагами structure; группа
		// диаграммы — путь со шагом points или series (проверяется первым), группа таблицы — со шагом rows или columns
		assert.ok(/allMatch\(step -> "structure"\.equals\(step\.list\(\)\)\)/.test(java), 'охват запрета у md-sparrow изменился');
		const chartGroup = java.search(/anyMatch\(step -> List\.of\("points", "series"\)\.contains\(step\.list\(\)\)\)/);
		const tableGroup = java.search(/anyMatch\(step -> List\.of\("rows", "columns"\)\.contains\(step\.list\(\)\)\)/);
		assert.ok(chartGroup > 0 && tableGroup > chartGroup, 'охват групп таблицы и диаграммы у md-sparrow изменился');
	});

	test('уровень узла: корень, группировка структуры на любой глубине, таблица, диаграмма и их группы', () => {
		const s = (index = 0): PathStep => ({ list: 'structure', index });
		const step = (list: string): PathStep => ({ list, index: 0 });
		const cases: Array<[unknown, PathStep[], string]> = [
			[{}, [], 'root'],
			[{ kind: 'group' }, [s()], 'group'],
			[{ kind: 'group' }, [s(), s(1)], 'group'],
			[{ kind: 'table' }, [s()], 'table'],
			[{ kind: 'chart' }, [s(), s()], 'chart'],
			[{ kind: 'group' }, [s(), step('rows')], 'tableGroup'],
			[{ kind: 'group' }, [s(), step('columns')], 'tableGroup'],
			[{ kind: 'group' }, [s(), step('rows'), s()], 'tableGroup'],
			[{ kind: 'group' }, [s(), step('points')], 'chartGroup'],
			[{ kind: 'group' }, [s(), step('series'), s()], 'chartGroup'],
		];
		for (const [node, nodePath, level] of cases) {
			assert.equal(levels.outputLevelOf(node, nodePath), level, JSON.stringify(nodePath));
		}
	});

	test('расположение общих итогов хранится только у групп таблицы', () => {
		for (const level of ['root', 'group', 'table', 'chart', 'chartGroup']) {
			assert.equal(levels.outputNotStored('РасположениеОбщихИтогов', level), true, level);
		}
		assert.equal(levels.outputNotStored('РасположениеОбщихИтогов', 'tableGroup'), false);
		assert.equal(levels.outputNotStored('КоличествоЗаписей', 'group'), false, 'у группировки количество записей хранится');
		assert.equal(levels.outputNotStored('ВыводитьПараметрыДанных', 'root'), false, 'в корне вывод параметров данных хранится');
		assert.equal(levels.outputNotStored('ТипДиаграммы', 'chart'), false, 'у диаграммы тип диаграммы хранится');
		assert.equal(levels.outputNotStored('КоличествоЗаписей', 'chartGroup'), false, 'у точки количество записей хранится');
		assert.equal(levels.outputNotStored('НеИзСловаря', 'chart'), false, 'имя вне таблицы рангов не ограничивается');
		assert.equal(levels.outputNotStored('ТипМакета', 'nestedObject'), false, 'вложенный отчёт — без списка');
		assert.match(levels.outputNotStoredReason('root'), /в корне варианта/);
		assert.match(levels.outputNotStoredReason('group'), /у группировки/);
		assert.equal(levels.outputNotStoredReason('table'), 'платформа не хранит этот параметр у таблицы: загрузка его отбрасывает');
		assert.equal(levels.outputNotStoredReason('tableGroup'), 'платформа не хранит этот параметр у группы строк или колонок таблицы: загрузка его отбрасывает');
		assert.equal(levels.outputNotStoredReason('chart'), 'платформа не хранит этот параметр у диаграммы: загрузка его отбрасывает');
		assert.equal(levels.outputNotStoredReason('chartGroup'), 'платформа не хранит этот параметр у группы точек или серий диаграммы: загрузка его отбрасывает');
	});

	test('строка записанного параметра: имя галки — параметр, вопрос удаления — сначала причина, потом вопрос', () => {
		assert.equal(levels.outputUseLabel('ФиксацияСверху'), 'Использовать параметр «ФиксацияСверху»');
		assert.equal(
			levels.outputUnkeptQuestion('ВыводитьПараметрыДанных', 'group'),
			'Платформа не хранит «ВыводитьПараметрыДанных» у группировки. Удалить строку?'
		);
		assert.equal(levels.outputUnkeptQuestion('ТипМакета', 'root'), 'Платформа не хранит «ТипМакета» в корне варианта. Удалить строку?');
		assert.equal(levels.outputUnkeptQuestion('ТипДиаграммы', 'table'), 'Платформа не хранит «ТипДиаграммы» у таблицы. Удалить строку?');
		assert.equal(levels.outputUnkeptQuestion('ФиксацияСверху', 'chartGroup'), 'Платформа не хранит «ФиксацияСверху» у группы точек или серий диаграммы. Удалить строку?');
	});

	test('подключение: панель не предлагает такие параметры, записанные — только просмотр и удаление', () => {
		const panel = between(SCRIPT, 'function renderOutputPanel(', 'function appendOutputRow(');
		assert.ok(panel.includes('const level = outputLevelOf(node, path);'));
		assert.ok(panel.includes('const names = outputAddable(kind, level, records);'), '«+ Добавить параметр» собирается не по правилу');
		assert.ok(/if \(outputNotStored\(name, level\)\) \{\s*return false;\s*\}/.test(between(SCRIPT, 'function outputAddable(', 'function outputNotStoredReason(')), 'правило предлагает нехранимое');
		assert.ok(panel.includes("'dcs-plate dcs-plate-warn'"), 'нет предупреждения о записанных');
		const row = between(SCRIPT, 'function appendOutputRow(', 'function openOutputParamDialog(');
		assert.ok(row.includes("box.setAttribute('aria-label', outputUseLabel(name));"), 'у галки нет доступного имени');
		assert.ok(/if \(unkept\) \{\s*box\.disabled = true;/.test(row), 'галка использования не заблокирована');
		assert.ok(row.includes("box.setAttribute('aria-description', outputNotStoredReason(level));"), 'причина только в title');
		assert.ok(/if \(unkept\) \{\s*valueTd\.appendChild\(el\('span', 'dcs-ro-note'/.test(row), 'значение не только для просмотра');
		assert.ok(row.includes('outputUnkeptQuestion(name, level)'));
		assert.ok(row.includes('{ remove: true }'), 'удаление шлёт не remove');
	});

	test('настройки фикстуры (выгрузки БСП) держат параметры вывода только там, где платформа их хранит', () => {
		const fixture = JSON.parse(read(path.join(FIXTURES, 'wizard-settings.json'))) as Record<string, { settings: Record<string, unknown> }>;
		const byLevel = new Map<string, number>();
		const totalsAtTableGroup: string[] = [];
		const walk = (node: Record<string, unknown>, nodePath: PathStep[], where: string): void => {
			const output = node.outputParameters as { items?: Array<{ parameter?: string }> } | undefined;
			const level = levels.outputLevelOf(node, nodePath);
			for (const item of output?.items ?? []) {
				byLevel.set(level, (byLevel.get(level) ?? 0) + 1);
				assert.equal(levels.outputNotStored(item.parameter ?? '', level), false, `${where}: ${item.parameter} (${level})`);
				if (level === 'tableGroup' && item.parameter === 'РасположениеОбщихИтогов') {
					totalsAtTableGroup.push(where);
				}
			}
			for (const list of ['structure', 'rows', 'columns', 'points', 'series']) {
				const children = node[list];
				if (Array.isArray(children)) {
					children.forEach((child, index) => {
						walk(child as Record<string, unknown>, nodePath.concat([{ list, index }]), where);
					});
				}
			}
		};
		for (const [name, entry] of Object.entries(fixture)) {
			walk(entry.settings, [], name);
		}
		// Граница уровней на настоящих данных: расположение общих итогов у вложенной группы строки таблицы
		// (как в схеме БСП «Результаты проверки учёта») окно принимает, хотя в корне и у группировки — нет
		assert.deepEqual(totalsAtTableGroup, ['таблица-итоги-у-группы-строки']);
		for (const level of ['root', 'group', 'tableGroup']) {
			assert.ok((byLevel.get(level) ?? 0) > 0, `в фикстуре нет параметров вывода уровня ${level}`);
		}
	});

	/** Узлы проверки: вид узла для kinds словаря и уровень. */
	const NODE_KINDS: Array<{ kind: string; level: string }> = [
		{ kind: 'root', level: 'root' },
		{ kind: 'group', level: 'group' },
		{ kind: 'table', level: 'table' },
		{ kind: 'group', level: 'tableGroup' },
		{ kind: 'chart', level: 'chart' },
		{ kind: 'group', level: 'chartGroup' },
	];

	test('«+ Добавить параметр» на каждом уровне предлагает только хранимое и не предлагает записанное', () => {
		const counts: Record<string, number> = {};
		for (const { kind, level } of NODE_KINDS) {
			const addable = levels.outputAddable(kind, level, []);
			counts[level] = addable.length;
			for (const name of addable) {
				assert.equal(levels.outputNotStored(name, level), false, `${level}: предложен ${name}`);
			}
			// Записанное не предлагается повторно
			if (addable.length > 0) {
				assert.ok(!levels.outputAddable(kind, level, [{ parameter: addable[0] }]).includes(addable[0]), `${level}: записанное предложено`);
			}
		}
		// Тип диаграммы — только в корне и у диаграммы, вариант использования группировки — только у групп (kinds словаря)
		assert.deepEqual(counts, { root: 17, group: 16, table: 12, tableGroup: 15, chart: 3, chartGroup: 2 });
		assert.deepEqual(sorted(levels.outputAddable('chart', 'chart', [])), sorted(['ТипДиаграммы', 'ВыводитьЗаголовок', 'Заголовок']));
		assert.deepEqual(sorted(levels.outputAddable('group', 'chartGroup', [])), sorted(['КоличествоЗаписей', 'ПроцентЗаписей']));
		assert.ok(levels.outputAddable('group', 'tableGroup', []).includes('РасположениеОбщихИтогов'));
		assert.ok(levels.outputAddable('group', 'tableGroup', []).includes('ВариантИспользованияГруппировки'));
		assert.ok(!levels.outputAddable('table', 'table', []).includes('РасположениеОбщихИтогов'));
	});

	/** Значение, которое окно «Параметр вывода» шлёт по словарю (число — введённое, строка — набранная). */
	const windowValue = (name: string): Record<string, unknown> => {
		const dict = levels.OUTPUT_PARAMS[name];
		if (dict.control === 'number') {
			return { type: 'xs:decimal', decoded: 5 };
		}
		if (dict.control === 'text') {
			return { type: dict.type, decoded: 'Проба' };
		}
		return { type: dict.type, decoded: dict.defaultValue || dict.options[0].value };
	};

	test('живой md-sparrow: на каждом уровне то, что окно предлагает, записывается, а остальное — отказ (если задан MD_SPARROW_JAR)', async (t) => {
		const jar = process.env.MD_SPARROW_JAR;
		if (!jar || !fs.existsSync(jar)) {
			t.diagnostic('уровни параметров вывода не сверены с живым md-sparrow: задайте MD_SPARROW_JAR (и при нужде MD_SPARROW_JAVA)');
			t.skip('jar md-sparrow не задан');
			return;
		}
		const work = fs.mkdtempSync(path.join(os.tmpdir(), 'dcs-output-levels-'));
		try {
			const variant = 'Дополнительный1';
			const objectXml = path.join(work, 'Template.xml');
			fs.copyFileSync(path.join(FIXTURES, 'Template-variants.xml'), objectXml);
			// Структура варианта — пакетом: группировка (есть в фикстуре), таблица с группой строк, диаграмма с группой точек
			const s = (index: number): PathStep => ({ list: 'structure', index });
			const add = (parentPath: PathStep[], list: string, kind?: string): Record<string, unknown> => ({
				op: 'cf-dcs-add-structure-item',
				objectXml,
				schemaVersion: 'V2_20',
				variant,
				payloadJson: JSON.stringify(kind ? { parentPath, list, kind } : { parentPath, list }),
			});
			runJar(jar, work, 'apply-mutation', {
				op: 'batch',
				operations: [add([], 'structure', 'table'), add([s(1)], 'rows'), add([], 'structure', 'chart'), add([s(2)], 'points')],
			});
			const settings = (
				JSON.parse(runJar(jar, work, 'read-json', { op: 'cf-dcs-settings-info', objectXml, schemaVersion: 'V2_20', variant })) as {
					variants: Array<{ settings: Record<string, unknown> }>;
				}
			).variants[0].settings;
			const nodes: Array<{ path: PathStep[]; level: string }> = [
				{ path: [], level: 'root' },
				{ path: [s(0)], level: 'group' },
				{ path: [s(1)], level: 'table' },
				{ path: [s(1), { list: 'rows', index: 0 }], level: 'tableGroup' },
				{ path: [s(2)], level: 'chart' },
				{ path: [s(2), { list: 'points', index: 0 }], level: 'chartGroup' },
			];
			const nodeAt = (root: Record<string, unknown>, nodePath: PathStep[]): Record<string, unknown> =>
				nodePath.reduce<Record<string, unknown>>((node, step) => (node[step.list] as Array<Record<string, unknown>>)[step.index], root);
			const outputNames = (root: Record<string, unknown>, nodePath: PathStep[]): string[] =>
				((nodeAt(root, nodePath).outputParameters as { items?: Array<{ parameter?: string }> } | undefined)?.items ?? []).map((item) => item.parameter ?? '');
			const setValue = (file: string, nodePath: PathStep[], name: string): Record<string, unknown> => ({
				op: 'cf-dcs-set-parameter-value',
				objectXml: file,
				schemaVersion: 'V2_20',
				variant,
				payloadJson: JSON.stringify({ section: 'output', path: nodePath, parameter: name, value: windowValue(name) }),
			});
			const before = fs.readFileSync(objectXml);
			const tasks: Array<() => Promise<string>> = [];
			let seq = 0;
			for (const node of nodes) {
				const level = levels.outputLevelOf(nodeAt(settings, node.path), node.path);
				assert.equal(level, node.level, JSON.stringify(node.path));
				// Хранимое на уровне — одним пакетом на своей копии (пакет откатывается целиком при первом отказе); после
				// записи у узла есть каждый из них
				const kept = Object.keys(levels.OUTPUT_PARAMS).filter((name) => !levels.outputNotStored(name, level));
				const copy = path.join(work, `${level}.xml`);
				fs.copyFileSync(objectXml, copy);
				const keptFile = path.join(work, `params-${(seq += 1)}.json`);
				const infoFile = path.join(work, `params-${(seq += 1)}.json`);
				tasks.push(async () => {
					const result = await callJarAsync(jar, keptFile, 'apply-mutation', { op: 'batch', operations: kept.map((name) => setValue(copy, node.path, name)) });
					if (result.status !== 0) {
						return `${level}: хранимое отклонено (${result.status}): ${result.err}${result.out}`;
					}
					const info = await callJarAsync(jar, infoFile, 'read-json', { op: 'cf-dcs-settings-info', objectXml: copy, schemaVersion: 'V2_20', variant });
					const written = outputNames((JSON.parse(info.out) as { variants: Array<{ settings: Record<string, unknown> }> }).variants[0].settings, node.path);
					const missing = kept.filter((name) => !written.includes(name));
					return missing.length === 0 ? '' : `${level}: не записано ${missing.join(', ')}`;
				});
				// Нехранимое — по одному на общем файле: каждый вызов обязан кончиться отказом кодом 2 без записи
				for (const name of levels.OUTPUT_PARAMS_NOT_STORED[level]) {
					const file = path.join(work, `params-${(seq += 1)}.json`);
					tasks.push(async () => {
						const result = await callJarAsync(jar, file, 'apply-mutation', setValue(objectXml, node.path, name));
						if (result.status !== 2) {
							return `${level}: ${name} — код ${result.status}, ждали отказ`;
						}
						return /Параметр вывода «[^»]+»: платформа не хранит этот параметр вывода/.test(result.err + result.out) ? '' : `${level}: ${name} — не тот отказ: ${result.err}`;
					});
				}
			}
			const problems = (await inPool(tasks, JAR_POOL)).filter(Boolean);
			assert.deepEqual(problems, []);
			assert.ok(fs.readFileSync(objectXml).equals(before), 'отказ изменил файл');
			t.diagnostic(`уровней ${nodes.length}, вызовов jar ${tasks.length}`);
		} finally {
			fs.rmSync(work, { recursive: true, force: true });
		}
	});
});
