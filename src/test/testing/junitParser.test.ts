import * as assert from 'node:assert';
import { parseJUnitXml } from '../../features/testing/parsers/junitParser';

suite('junitParser', () => {
	test('разбирает отчёт с корнем testsuites', () => {
		const xml = `<?xml version="1.0" encoding="UTF-8"?>
<testsuites>
	<testsuite name="ТестыСложения" tests="2" failures="1" time="1.5">
		<testcase classname="ТестыСложения" name="ТестДолжен_ПроверитьСложение" time="0.5"/>
		<testcase classname="ТестыСложения" name="ТестДолжен_Упасть" time="1.0">
			<failure message="Ожидали 4, получили 5">Подробности падения
со второй строкой</failure>
		</testcase>
	</testsuite>
</testsuites>`;

		const cases = parseJUnitXml(xml);
		assert.strictEqual(cases.length, 2);
		assert.strictEqual(cases[0].status, 'passed');
		assert.strictEqual(cases[0].name, 'ТестДолжен_ПроверитьСложение');
		assert.strictEqual(cases[0].suiteName, 'ТестыСложения');
		assert.strictEqual(cases[0].timeMs, 500);
		assert.strictEqual(cases[1].status, 'failed');
		assert.strictEqual(cases[1].message, 'Ожидали 4, получили 5');
		assert.ok(cases[1].details?.includes('со второй строкой'));
	});

	test('разбирает отчёт с одиночным корнем testsuite', () => {
		const xml = `<testsuite name="Один">
	<testcase classname="Один" name="Тест1"/>
</testsuite>`;

		const cases = parseJUnitXml(xml);
		assert.strictEqual(cases.length, 1);
		assert.strictEqual(cases[0].status, 'passed');
	});

	test('распознаёт error и skipped', () => {
		const xml = `<testsuites>
	<testsuite name="S">
		<testcase name="С ошибкой"><error message="Исключение"/></testcase>
		<testcase name="Пропущен"><skipped/></testcase>
	</testsuite>
</testsuites>`;

		const cases = parseJUnitXml(xml);
		assert.strictEqual(cases[0].status, 'error');
		assert.strictEqual(cases[0].message, 'Исключение');
		assert.strictEqual(cases[1].status, 'skipped');
	});

	test('поддерживает CDATA и спецсимволы в сообщениях', () => {
		const xml = `<testsuite name="S">
	<testcase name="Кавычки">
		<failure message="Поле &quot;Наименование&quot; не заполнено"><![CDATA[Стек <вызовов> & детали]]></failure>
	</testcase>
</testsuite>`;

		const cases = parseJUnitXml(xml);
		assert.strictEqual(cases[0].message, 'Поле "Наименование" не заполнено');
		assert.strictEqual(cases[0].details, 'Стек <вызовов> & детали');
	});

	test('поддерживает вложенные testsuite и время с запятой', () => {
		const xml = `<testsuites>
	<testsuite name="Внешний">
		<testsuite name="Внутренний">
			<testcase name="Тест" time="0,25"/>
		</testsuite>
	</testsuite>
</testsuites>`;

		const cases = parseJUnitXml(xml);
		assert.strictEqual(cases.length, 1);
		assert.strictEqual(cases[0].suiteName, 'Внутренний');
		assert.strictEqual(cases[0].timeMs, 250);
	});

	test('пустой testsuite даёт пустой список', () => {
		assert.deepStrictEqual(parseJUnitXml('<testsuite name="Пусто"/>'), []);
	});

	test('XML без testsuite вызывает ошибку', () => {
		assert.throws(() => parseJUnitXml('<root/>'), /testsuites\/testsuite/);
	});
});
