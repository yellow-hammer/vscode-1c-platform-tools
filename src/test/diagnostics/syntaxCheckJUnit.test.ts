import * as assert from 'node:assert';
import * as path from 'node:path';
import {
	locateSyntaxCheckFiles,
	parseSyntaxCheckFindings,
	toSyntaxCheckErrors,
	type SyntaxCheckFinding,
} from '../../features/diagnostics/syntaxCheckJUnit';
import { resolveMetadataInRoots } from '../../features/tools/terminalLinks';
import { invalidateProjectLayout, resolveProjectLayout, setLayoutExclusions } from '../../shared/projectLayout';

/** Рабочая область с проектами EDT. */
const EDT_WORKSPACE = path.resolve(__dirname, '../../../src/test/fixtures/projectLayout/edt-workspace');

/** Выгрузка конфигуратора в привычном месте. */
const DESIGNER_CF = { dir: 'src/cf', format: 'designer' as const };

/** Находка с текстом по умолчанию. */
const finding = (metadataPath: string): SyntaxCheckFinding => ({ metadataPath, message: 'Ошибка', severity: 'error' });

suite('syntaxCheckJUnit', () => {
	test('разворачивает многострочный message в отдельные находки', () => {
		// Формат vrunner syntax-check (ssl_3_1): несколько ошибок в одном message
		const xml = `<?xml version="1.0" encoding="utf-8"?>
<testsuites name="CheckConfig.base" tests="2" failures="2">
	<testsuite name="CheckConfig.base">
		<testcase classname="CheckConfig.base.Ошибка" name="ОбщийМодуль.РаботаСФайламиКлиент.Модуль">
			<failure type="ERROR" message="Использование синхронного вызова: &quot;УдалитьФайлы&quot;&#xA;Использование синхронного вызова: &quot;Существует&quot;"/>
		</testcase>
		<testcase classname="CheckConfig.base.Ошибка" name="HTTPСервис.Биллинг.Модуль">
			<failure type="ERROR" message="Возможно ошибочный метод: &quot;УдалитьЗапись&quot;"/>
		</testcase>
	</testsuite>
</testsuites>`;

		const findings = parseSyntaxCheckFindings(xml);
		assert.strictEqual(findings.length, 3);

		assert.strictEqual(findings[0].metadataPath, 'ОбщийМодуль.РаботаСФайламиКлиент.Модуль');
		assert.strictEqual(findings[0].message, 'Использование синхронного вызова: "УдалитьФайлы"');
		assert.strictEqual(findings[0].severity, 'error');
		assert.strictEqual(findings[1].message, 'Использование синхронного вызова: "Существует"');

		assert.strictEqual(findings[2].metadataPath, 'HTTPСервис.Биллинг.Модуль');
		assert.strictEqual(findings[2].message, 'Возможно ошибочный метод: "УдалитьЗапись"');
	});

	test('распознаёт предупреждения по classname', () => {
		const xml = `<testsuites name="CheckConfig.base">
	<testsuite name="CheckConfig.base">
		<testcase classname="CheckConfig.base.Предупреждение" name="ОбщийМодуль.Имя.Модуль">
			<failure message="Что-то подозрительное"/>
		</testcase>
	</testsuite>
</testsuites>`;

		const findings = parseSyntaxCheckFindings(xml);
		assert.strictEqual(findings.length, 1);
		assert.strictEqual(findings[0].severity, 'warning');
	});

	test('чистый отчёт без падений — пусто', () => {
		const xml = `<testsuites name="CheckConfig.base" tests="0" failures="0">
	<testsuite name="CheckConfig.base"><properties/></testsuite>
</testsuites>`;
		assert.deepStrictEqual(parseSyntaxCheckFindings(xml), []);
	});

	test('failure без message даёт обобщённую находку', () => {
		const xml = `<testsuites name="CheckConfig.base">
	<testsuite name="CheckConfig.base">
		<testcase classname="CheckConfig.base.Ошибка" name="ОбщийМодуль.Имя.Модуль">
			<failure type="ERROR"/>
		</testcase>
	</testsuite>
</testsuites>`;
		const findings = parseSyntaxCheckFindings(xml);
		assert.strictEqual(findings.length, 1);
		assert.strictEqual(findings[0].message, 'Ошибка синтаксического контроля');
	});
});

suite('toSyntaxCheckErrors', () => {
	test('модуль раскладывается в путь к .bsl', () => {
		const errors = toSyntaxCheckErrors(
			[{ metadataPath: 'ОбщийМодуль.ОбщегоНазначения.Модуль', message: 'Переменная не определена', severity: 'error' }],
			new Map(),
			DESIGNER_CF
		);

		assert.strictEqual(errors.length, 1);
		assert.strictEqual(errors[0].filepath, 'src/cf/CommonModules/ОбщегоНазначения/Ext/Module.bsl');
		assert.strictEqual(errors[0].metadataPath, 'ОбщийМодуль.ОбщегоНазначения.Модуль');
		assert.strictEqual(errors[0].severity, 'error');
	});

	test('нераскладываемый тип оставляет путь по метаданным', () => {
		const errors = toSyntaxCheckErrors(
			[{ metadataPath: 'Справка.Раздел', message: 'Ошибка в справке', severity: 'warning' }],
			new Map(),
			DESIGNER_CF
		);

		assert.strictEqual(errors[0].filepath, 'Справка.Раздел');
		assert.strictEqual(errors[0].severity, 'warning');
	});

	test('конфигурация в корне рабочей области: путь без ведущей точки', () => {
		const errors = toSyntaxCheckErrors([finding('ОбщийМодуль.Имя.Модуль')], new Map(), { dir: '.', format: 'designer' });

		assert.strictEqual(errors[0].filepath, 'CommonModules/Имя/Ext/Module.bsl');
	});

	test('проект EDT: адрес найденного модуля берётся с диска, ненайденный раскладывается через src', async () => {
		setLayoutExclusions(() => []);
		invalidateProjectLayout();
		const layout = await resolveProjectLayout(EDT_WORKSPACE);
		const roots = [...(layout.configuration ? [layout.configuration] : []), ...layout.extensions, ...layout.testExtensions];
		const findings = [
			finding('ОбщийМодуль.ОбщийТест.Модуль'),
			finding('ОбщийМодуль.ОбщийТест.Модуль'),
			finding('Справочник.Валюты.Форма.ФормаСписка.Форма'),
			finding('ОбщийМодуль.НетТакого.Модуль'),
			finding('Справка.Раздел'),
		];

		const located = await locateSyntaxCheckFiles(
			findings,
			(metadataPath) => resolveMetadataInRoots(metadataPath, roots),
			EDT_WORKSPACE
		);
		const errors = toSyntaxCheckErrors(findings, located, { dir: 'ssl31', format: 'edt' });

		assert.deepStrictEqual(errors.map((error) => error.filepath), [
			'ssl31/src/CommonModules/ОбщийТест/Module.bsl',
			'ssl31/src/CommonModules/ОбщийТест/Module.bsl',
			'ssl31/src/Catalogs/Валюты/Forms/ФормаСписка/Module.bsl',
			'ssl31/src/CommonModules/НетТакого/Module.bsl',
			'Справка.Раздел',
		]);
	});
	test('запись vanessa-runner 3: путь и текст склеены в name', () => {
		// Формат 3.0.0-rc14: classname=syntax-check, в name путь и текст через пробел
		const xml = `<?xml version="1.0" encoding="utf-8"?>
<testsuites>
	<testsuite name="syntax-check" tests="1" failures="1">
		<testcase name="HTTPСервис.Биллинг.Модуль Возможно ошибочный метод: &quot;УдалитьЗапись&quot;" classname="syntax-check">
			<failure message="HTTPСервис.Биллинг.Модуль Возможно ошибочный метод: &quot;УдалитьЗапись&quot;"/>
		</testcase>
	</testsuite>
</testsuites>`;

		const findings = parseSyntaxCheckFindings(xml);

		assert.strictEqual(findings.length, 1);
		assert.strictEqual(findings[0].metadataPath, 'HTTPСервис.Биллинг.Модуль');
		assert.strictEqual(findings[0].message, 'Возможно ошибочный метод: "УдалитьЗапись"');
		assert.strictEqual(findings[0].severity, 'error');
	});

	test('замечание без пути по метаданным остаётся целым', () => {
		const xml = `<?xml version="1.0" encoding="utf-8"?>
<testsuites>
	<testsuite name="syntax-check" tests="1" failures="1">
		<testcase name="Не удалось открыть конфигурацию" classname="syntax-check">
			<failure message="Не удалось открыть конфигурацию"/>
		</testcase>
	</testsuite>
</testsuites>`;

		const findings = parseSyntaxCheckFindings(xml);

		assert.strictEqual(findings.length, 1);
		assert.strictEqual(findings[0].metadataPath, 'Не удалось открыть конфигурацию');
	});
});
