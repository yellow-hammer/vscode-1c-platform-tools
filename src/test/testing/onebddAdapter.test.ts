import * as assert from 'node:assert';
import { aggregateBddStepsToScenarios } from '../../features/testing/adapters/onebddAdapter';
import { parseJUnitXml } from '../../features/testing/parsers/junitParser';

suite('onebddAdapter', () => {
	test('агрегация реального отчёта 1bdd: шаги → сценарии, статус атрибутом', () => {
		// Дословный фрагмент отчёта 1bdd 1.15.1 (testcase = шаг, статус атрибутом)
		const xml = `<?xml version="1.0" encoding="utf-8"?>
<testsuites name="1bdd" time="0" tests="1" failures="0" skipped="1">
	<testsuite name="Проверка работы с отрицательными числами">
		<properties/>
		<testcase classname="Передача отрицательного числа в сценарий" name="я передал в шаг числовой параметр -1" status="skipped"/>
	</testsuite>
</testsuites>`;

		const steps = parseJUnitXml(xml);
		assert.strictEqual(steps[0].status, 'skipped', 'Статус из атрибута status');

		const scenarios = aggregateBddStepsToScenarios(steps);
		assert.strictEqual(scenarios.length, 1);
		assert.strictEqual(scenarios[0].name, 'Передача отрицательного числа в сценарий');
		assert.strictEqual(scenarios[0].status, 'skipped');
	});

	test('агрегация: упавший шаг делает сценарий failed, пройденные — passed', () => {
		const steps = parseJUnitXml(`<testsuite name="Фича">
	<testcase classname="Сценарий А" name="шаг 1" time="0.5"/>
	<testcase classname="Сценарий А" name="шаг 2" time="0.5"><failure message="Ожидали 1">стек</failure></testcase>
	<testcase classname="Сценарий Б" name="шаг 1" time="1"/>
</testsuite>`);

		const scenarios = aggregateBddStepsToScenarios(steps);
		const a = scenarios.find((s) => s.name === 'Сценарий А');
		const b = scenarios.find((s) => s.name === 'Сценарий Б');

		assert.strictEqual(a?.status, 'failed');
		assert.ok(a?.message?.includes('шаг 2'), 'Имя упавшего шага в сообщении');
		assert.strictEqual(a?.timeMs, 1000, 'Длительности шагов суммируются');
		assert.strictEqual(b?.status, 'passed');
	});

	test('сценарий из пройденных и пропущенных шагов — passed', () => {
		const steps = parseJUnitXml(`<testsuite name="Фича">
	<testcase classname="С" name="шаг 1"/>
	<testcase classname="С" name="шаг 2" status="skipped"/>
</testsuite>`);
		assert.strictEqual(aggregateBddStepsToScenarios(steps)[0].status, 'passed');
	});
});
