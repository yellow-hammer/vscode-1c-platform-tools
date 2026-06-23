import * as assert from 'node:assert';
import * as vscode from 'vscode';
import { VRunnerManager } from '../../shared/vrunnerManager';
import { OneScriptAdapter } from '../../features/testing/adapters/onescriptAdapter';

suite('onescriptAdapter', () => {
	const fileUri = vscode.Uri.file('C:\\proj\\tests os\\test_example.os');

	test('buildRunPlan (1testrunner): jUnit-отчёт через xddReportPath', async () => {
		const adapter = new OneScriptAdapter(VRunnerManager.getInstance());

		const plan = await adapter.buildRunPlan({ fileUri }, 'C:\\proj\\build\\report');
		assert.strictEqual(plan.tool, 'shell');
		assert.ok(plan.args[0].includes('1testrunner'));
		assert.ok(plan.args[0].includes('-run "'));
		assert.ok(plan.args[0].includes('xddReportPath'), 'Отчёт пишется через xddReportPath');
		assert.ok(plan.reportTarget, 'Есть цель отчёта');
		assert.ok(
			plan.reportTarget.path.endsWith('test_example.os.xml'),
			'Отчёт по имени файла теста'
		);
		assert.ok(
			plan.reportTarget.path.includes('onescript'),
			'Отчёты в постоянном каталоге build/out/onescript'
		);
	});

	test('buildRunPlan (1testrunner): один кейс гонит весь файл, без фильтра по имени', async () => {
		const adapter = new OneScriptAdapter(VRunnerManager.getInstance());

		const plan = await adapter.buildRunPlan(
			{ fileUri, caseNames: ['ТестДолжен_Проверить'] },
			'C:\\proj\\build\\report'
		);
		// 1testrunner сам выбирает имя файла отчёта по набору тестов: при точечном
		// фильтре оно расходится с <файл>.os.xml и отчёт не находится. Поэтому фильтр
		// по имени не передаём — гоняем весь файл (отчёт остаётся test_example.os.xml).
		assert.ok(
			!plan.args[0].includes('"ТестДолжен_Проверить"'),
			'Имя теста не передаётся в 1testrunner — запускается весь файл'
		);
		assert.ok(plan.args[0].includes('xddReportPath'), 'Отчёт пишется через xddReportPath');
		assert.ok(
			plan.reportTarget?.path.endsWith('test_example.os.xml'),
			'Отчёт по имени файла теста'
		);
	});

	test('parseFile распознаёт xdd-структуру и аннотации', () => {
		const adapter = new OneScriptAdapter(VRunnerManager.getInstance());
		const classic = [
			'Функция ИсполняемыеСценарии() Экспорт',
			'КонецФункции',
			'Процедура Тест_Один() Экспорт',
			'КонецПроцедуры'
		].join('\n');
		const annotated = '&Тест\nПроцедура Тест_Два() Экспорт\nКонецПроцедуры';

		assert.strictEqual(adapter.parseFile(classic)?.cases[0].name, 'Тест_Один');
		assert.strictEqual(adapter.parseFile(annotated)?.cases[0].name, 'Тест_Два');
	});
});
