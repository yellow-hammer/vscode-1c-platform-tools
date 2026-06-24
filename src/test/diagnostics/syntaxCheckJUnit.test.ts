import * as assert from 'node:assert';
import { parseSyntaxCheckFindings } from '../../features/diagnostics/syntaxCheckJUnit';

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
