import * as assert from 'node:assert';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import {
	commonParent,
	describeMarker,
	externalDirectory,
	externalEntry,
	externalKindOfHead,
	invalidateProjectLayout,
	isTestPath,
	markerIn,
	resolveProjectLayout,
	setLayoutExclusions,
	setTestsDirectory,
	sourceEntry,
} from '../../shared/projectLayout';

/** Рабочие области с исходным кодом в форматах EDT и конфигуратора. */
const FIXTURES = path.resolve(__dirname, '../../../src/test/fixtures/projectLayout');
const EDT_WORKSPACE = path.join(FIXTURES, 'edt-workspace');
const DESIGNER_WORKSPACE = path.join(FIXTURES, 'designer');

const relative = (root: string, dir: string) => path.relative(root, dir).split(path.sep).join('/');

suite('раскладка проекта', () => {
	setup(() => {
		setLayoutExclusions(() => []);
		invalidateProjectLayout();
	});

	test('маркер отличает формат конфигуратора от формата EDT', () => {
		assert.strictEqual(markerIn(path.join(DESIGNER_WORKSPACE, 'src/cf'))?.format, 'designer');
		assert.strictEqual(markerIn(path.join(EDT_WORKSPACE, 'ssl31'))?.format, 'edt');
		assert.strictEqual(markerIn(EDT_WORKSPACE), undefined);
	});

	test('заголовок описания даёт имя, признак расширения и вид внешнего объекта', () => {
		const extension = [
			'<mdclass:Configuration uuid="2fd73213-5b64-4002-b842-6e6dbd6ab9fa">',
			'  <name>_ДемоРасширение</name>',
			'  <namePrefix>_Демо</namePrefix>',
			'  <objectBelonging>Adopted</objectBelonging>',
		].join('\n');
		assert.deepStrictEqual(describeMarker(extension, 'edt'), { name: '_ДемоРасширение', isExtension: true });
		assert.deepStrictEqual(describeMarker('<Configuration><Name>Демо</Name>', 'designer'), { name: 'Демо', isExtension: false });
		assert.strictEqual(externalKindOfHead('<?xml version="1.0"?><ExternalDataProcessor xmlns="...">'), 'processor');
		assert.strictEqual(externalKindOfHead('<mdclass:ExternalReport uuid="1">'), 'report');
		assert.strictEqual(externalKindOfHead('<mdclass:ExternalReportSettings>'), undefined);
	});

	test('файлы описаний: маркер у корня, описание объекта у внешнего', async () => {
		const edt = await resolveProjectLayout(EDT_WORKSPACE);
		assert.ok(edt.configuration);
		assert.strictEqual(relative(EDT_WORKSPACE, sourceEntry(edt.configuration)), 'ssl31/src/Configuration/Configuration.mdo');
		assert.strictEqual(relative(EDT_WORKSPACE, externalDirectory(edt.processors[0])), 'dp/src/ExternalDataProcessors/ТестоваяВнешняяОбработка');
		assert.strictEqual(relative(EDT_WORKSPACE, externalEntry(edt.reports[0])), 'dp/src/ExternalReports/ТестовыйВнешнийОтчет/ТестовыйВнешнийОтчет.mdo');

		const designer = await resolveProjectLayout(DESIGNER_WORKSPACE);
		assert.ok(designer.configuration);
		assert.strictEqual(relative(DESIGNER_WORKSPACE, sourceEntry(designer.configuration)), 'src/cf/Configuration.xml');
		assert.strictEqual(relative(DESIGNER_WORKSPACE, externalDirectory(designer.processors[0])), 'src/epf/ПечатьСчёта');
		assert.strictEqual(relative(DESIGNER_WORKSPACE, externalEntry(designer.processors[0])), 'src/epf/ПечатьСчёта/ПечатьСчёта.xml');

		// Выгрузка не требует, чтобы описание звалось как каталог, а собранный файл зовётся по каталогу
		const renamed = designer.reports.find((root) => root.name === 'ОтчётПоОстаткам');
		assert.ok(renamed);
		assert.strictEqual(relative(DESIGNER_WORKSPACE, externalEntry(renamed)), 'src/erf/ОтчётПоОстаткам/ОстаткиПоСкладам.xml');
	});

	test('каталог с несколькими описаниями не считается объектом', async () => {
		const layout = await resolveProjectLayout(DESIGNER_WORKSPACE);

		assert.strictEqual(
			layout.processors.some((root) => path.basename(root.dir) === 'каталог-обработок'),
			false
		);
	});

	test('выгрузка конфигуратора: конфигурация, расширения, внешние объекты и тестовое по каталогам', async () => {
		const layout = await resolveProjectLayout(DESIGNER_WORKSPACE);
		const rel = (dir: string) => relative(DESIGNER_WORKSPACE, dir);

		assert.strictEqual(rel(layout.configuration?.dir ?? ''), 'src/cf');
		assert.strictEqual(layout.configuration?.format, 'designer');
		assert.strictEqual(layout.configuration?.name, 'Конфигурация');
		assert.deepStrictEqual(layout.extensions.map((root) => [root.name, rel(root.dir)]), [
			['Расширение', 'src/cfe/МоёРасширение'],
			['Вложенное', 'src/cfe/подмодуль/src/cfe/Вложенное'],
		]);
		assert.deepStrictEqual(layout.testExtensions.map((root) => [root.name, rel(root.dir)]), [['Тесты', 'tests/cfe/Тесты']]);
		assert.deepStrictEqual(layout.processors.map((root) => [root.name, rel(root.dir), root.format]), [['ПечатьСчёта', 'src/epf/ПечатьСчёта', 'designer']]);
		assert.deepStrictEqual(layout.reports.map((root) => [root.name, rel(root.dir)]), [
			['ОстаткиТоваров', 'src/erf/ОстаткиТоваров'],
			['ОтчётПоОстаткам', 'src/erf/ОтчётПоОстаткам'],
		]);
		assert.deepStrictEqual(layout.testProcessors.map((root) => [root.name, rel(root.dir), root.kind]), [['Тесты_Арифметика', 'tests/epf/Тесты_Арифметика', 'processor']]);
		assert.deepStrictEqual(layout.others.map((root) => [root.name, rel(root.dir)]), [['Подмодуль', 'src/cfe/подмодуль/src/cf']]);
		assert.deepStrictEqual(layout.externals, []);
	});

	test('расширение из вложенного репозитория лежит под общим каталогом расширений', async () => {
		const layout = await resolveProjectLayout(DESIGNER_WORKSPACE);
		assert.strictEqual(commonParent(layout.extensions), path.join(DESIGNER_WORKSPACE, 'src', 'cfe'));
	});

	test('проекты EDT: конфигурации, расширения по именам из метаданных, внешние объекты проектами', async () => {
		const layout = await resolveProjectLayout(EDT_WORKSPACE);
		const rel = (dir: string) => relative(EDT_WORKSPACE, dir);

		assert.strictEqual(layout.configuration?.format, 'edt');
		assert.strictEqual(layout.configuration?.name, 'БиблиотекаСтандартныхПодсистемДемо');
		assert.strictEqual(rel(layout.configuration?.dir ?? ''), 'ssl31');
		assert.deepStrictEqual(layout.others.map((root) => rel(root.dir)), ['учёт']);
		assert.deepStrictEqual(
			layout.extensions.map((root) => [root.name, rel(root.dir)]),
			[['_ДемоРасширение', 'ssl31._ДемоРасширение'], ['РасширениеУчёта', 'учёт.РасширениеУчёта']]
		);
		assert.deepStrictEqual(layout.testExtensions.map((root) => [root.name, rel(root.dir)]), [['Тесты', 'tests/cfe/yaxunit-test']]);
		assert.deepStrictEqual(layout.processors.map((root) => [root.name, rel(root.dir), root.format]), [['ТестоваяВнешняяОбработка', 'dp', 'edt']]);
		assert.deepStrictEqual(layout.reports.map((root) => [root.name, rel(root.dir)]), [['ТестовыйВнешнийОтчет', 'dp']]);
		assert.deepStrictEqual(layout.testProcessors.map((root) => [root.name, rel(root.dir)]), [['Тесты_Арифметика', 'tests/epf/Тесты_Арифметика']]);
		assert.deepStrictEqual(layout.externals.map(rel), ['dp', 'tests/epf/Тесты_Арифметика']);
	});

	test('тестовое отличается каталогом тестов в пути, общий родитель даёт контейнер', () => {
		assert.strictEqual(isTestPath('/w', '/w/tests/cfe/Тесты'), true);
		assert.strictEqual(isTestPath('/w', '/w/src/cfe/Тесты'), false);
		assert.strictEqual(isTestPath('/w', '/w/tests'), false);
		// Регистр имени не важен: на Windows это один и тот же каталог
		assert.strictEqual(isTestPath('/w', '/w/Tests/cfe/Тесты'), true);
		assert.strictEqual(commonParent([{ dir: '/w/src/cfe/А' }, { dir: '/w/src/cfe/Б' }]), path.normalize('/w/src/cfe'));
		assert.strictEqual(commonParent([{ dir: '/w/src/cfe/А' }, { dir: '/w/src/cfe/репо/src/cfe/Б' }]), path.normalize('/w/src/cfe'));
		assert.strictEqual(commonParent([{ dir: '/w/src/cfe/А' }, { dir: '/w/other/Б' }]), path.normalize('/w'));
		assert.strictEqual(commonParent([]), undefined);
	});

	test('имя каталога тестов берётся из настройки', async () => {
		setTestsDirectory(() => 'проверки');
		try {
			assert.strictEqual(isTestPath('/w', '/w/проверки/cfe/Тесты'), true);
			assert.strictEqual(isTestPath('/w', '/w/tests/cfe/Тесты'), false);
			// Под другим именем каталог tests фикстуры перестаёт быть тестовым
			const layout = await resolveProjectLayout(DESIGNER_WORKSPACE);
			assert.deepStrictEqual(layout.testExtensions, []);
			assert.ok(layout.extensions.some((root) => root.name === 'Тесты'));
		} finally {
			setTestsDirectory(() => 'tests');
		}
		// Пустая настройка значит имя по умолчанию
		setTestsDirectory(() => '  ');
		try {
			assert.strictEqual(isTestPath('/w', '/w/tests/cfe/Тесты'), true);
		} finally {
			setTestsDirectory(() => 'tests');
		}
	});

	test('исключённые каталоги обход не смотрит', async () => {
		setLayoutExclusions(() => ['src']);
		const layout = await resolveProjectLayout(DESIGNER_WORKSPACE);
		assert.strictEqual(layout.configuration, undefined);
		assert.deepStrictEqual(layout.extensions, []);
		assert.deepStrictEqual(layout.testExtensions.map((root) => root.name), ['Тесты']);
	});

	test('повторный вызов отдаёт разобранную раскладку', async () => {
		const first = await resolveProjectLayout(EDT_WORKSPACE);
		const second = await resolveProjectLayout(EDT_WORKSPACE);
		assert.strictEqual(first, second);
	});

	test('после сброса раскладка читается заново', async () => {
		const first = await resolveProjectLayout(EDT_WORKSPACE);
		invalidateProjectLayout(EDT_WORKSPACE);
		const second = await resolveProjectLayout(EDT_WORKSPACE);
		assert.notStrictEqual(first, second);
		assert.deepStrictEqual(second, first);
	});

	test('без исходного кода раскладка пустая', async () => {
		const empty = fs.mkdtempSync(path.join(os.tmpdir(), 'layout-empty-'));
		try {
			const layout = await resolveProjectLayout(empty);
			assert.strictEqual(layout.configuration, undefined);
			assert.deepStrictEqual(layout.extensions, []);
			assert.deepStrictEqual(layout.processors, []);
			assert.deepStrictEqual(layout.testProcessors, []);
		} finally {
			fs.rmSync(empty, { recursive: true, force: true });
		}
	});
});
