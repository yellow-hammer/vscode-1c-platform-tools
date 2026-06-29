import * as assert from 'node:assert';
import * as vscode from 'vscode';
import { VRunnerManager } from '../../shared/vrunnerManager';
import { OneScriptAdapter, packagedefDeclaresDependency } from '../../features/testing/adapters/onescriptAdapter';

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

	test('isTestFile: тестовый модуль — да, хелпер без тестов — нет', () => {
		const adapter = new OneScriptAdapter(VRunnerManager.getInstance());
		const testModule = [
			'Функция ИсполняемыеСценарии() Экспорт',
			'КонецФункции',
			'Процедура Тест_Один() Экспорт',
			'КонецПроцедуры'
		].join('\n');
		// Хелпер/билдер из utils/: экспортные методы есть, но нет ни ИсполняемыеСценарии,
		// ни &Тест — в дереве тестов ему не место
		const helper = [
			'Функция Построить() Экспорт',
			'	Возврат Новый Структура;',
			'КонецФункции'
		].join('\n');

		assert.strictEqual(adapter.isTestFile(testModule), true);
		assert.strictEqual(adapter.isTestFile('&Тест\nПроцедура Т() Экспорт\nКонецПроцедуры'), true);
		assert.strictEqual(adapter.isTestFile(helper), false);
	});

	test('packagedefDeclaresDependency: ловит ЗависитОт и РазработкаЗависитОт', () => {
		const packagedef = [
			'Пакет',
			'	.Имя("проект")',
			'	.ЗависитОт("irac", "1.4.0")',
			'	.РазработкаЗависитОт("oneunit", "0.3.3")',
			';'
		].join('\n');

		assert.strictEqual(packagedefDeclaresDependency(packagedef, 'oneunit'), true, 'РазработкаЗависитОт');
		assert.strictEqual(packagedefDeclaresDependency(packagedef, 'irac'), true, 'ЗависитОт');
		assert.strictEqual(packagedefDeclaresDependency(packagedef, '1testrunner'), false, 'не объявлен');
	});

	test('buildBatchRunPlan: для 1testrunner батч недоступен (undefined)', async () => {
		// В тестовом окружении (без локального oneunit) раннер — 1testrunner,
		// батч им не поддержан: контроллер прогонит файлы поштучно
		const adapter = new OneScriptAdapter(VRunnerManager.getInstance());
		const plan = await adapter.buildBatchRunPlan([{ fileUri }], 'C:\\proj\\build\\report');
		assert.strictEqual(plan, undefined);
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
