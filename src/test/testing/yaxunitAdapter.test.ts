import * as assert from 'node:assert';
import * as os from 'node:os';
import * as path from 'node:path';
import * as fs from 'node:fs/promises';
import * as vscode from 'vscode';
import { VRunnerManager } from '../../shared/vrunnerManager';
import { YaxunitAdapter, extractModuleName } from '../../features/testing/adapters/yaxunitAdapter';

import { invalidateProjectLayout } from '../../shared/projectLayout';

/** Рабочие области с исходным кодом в обоих форматах. */
const FIXTURES = path.resolve(__dirname, '../../../src/test/fixtures/projectLayout');
const DESIGNER_WORKSPACE = path.join(FIXTURES, 'designer');
const EDT_WORKSPACE = path.join(FIXTURES, 'edt-workspace');

/** Раннер, знающий только корень рабочей области: остальное адаптер берёт из раскладки. */
function vrunnerAt(workspaceRoot: string): VRunnerManager {
	return {
		getWorkspaceRoot: () => workspaceRoot,
		planIntent: async () => [['run', 'enterprise']],
	} as unknown as VRunnerManager;
}

suite('yaxunitAdapter', () => {
	test('isTestFile: служебный модуль фреймворка (без зарегистрированных тестов) отсекается', async () => {
		const adapter = new YaxunitAdapter(VRunnerManager.getInstance());
		// Похоже на ЮТТестыСлужебный: есть ИсполняемыеСценарии и текст «ДобавитьТест(»,
		// но нет ни одной регистрации .ДобавитьТест("Имя") — это плумбинг, не тесты
		const serviceModule = [
			'Процедура ДобавитьТест(Знач НаборТестов, Знач ИмяТеста) Экспорт',
			'\tНаборТестов.Тесты.Добавить(ИмяТеста);',
			'КонецПроцедуры',
			'',
			'Функция ИсполняемыеСценарии() Экспорт',
			'\tВозврат Неопределено;',
			'КонецФункции'
		].join('\n');
		assert.strictEqual(adapter.isTestFile(serviceModule), false);
	});

	test('isTestFile: модуль с .ДобавитьТест("...") распознаётся тестовым', async () => {
		const adapter = new YaxunitAdapter(VRunnerManager.getInstance());
		const testModule = [
			'Процедура ИсполняемыеСценарии() Экспорт',
			'\tЮТТесты.ДобавитьТест("ПроверитьЗапись");',
			'КонецПроцедуры',
			'',
			'Процедура ПроверитьЗапись() Экспорт',
			'КонецПроцедуры'
		].join('\n');
		assert.strictEqual(adapter.isTestFile(testModule), true);
	});

	test('extractModuleName извлекает имя модуля из пути', () => {
		assert.strictEqual(
			extractModuleName('C:\\proj\\src\\cfe\\Тесты\\CommonModules\\ОМ_ПроверкаЗаписи\\Module.bsl'),
			'ОМ_ПроверкаЗаписи'
		);
		assert.strictEqual(
			extractModuleName('/proj/src/cfe/Tests/CommonModules/ТестыСложения/Module.bsl'),
			'ТестыСложения'
		);
	});

	test('buildRunPlan: весь модуль — filter.modules, подмножество — filter.tests', async () => {
		const adapter = new YaxunitAdapter(VRunnerManager.getInstance());
		const reportDir = await fs.mkdtemp(path.join(os.tmpdir(), 'yaxunit-test-'));
		const fileUri = vscode.Uri.file('C:\\proj\\src\\cfe\\T\\CommonModules\\ОМ_Тесты\\Module.bsl');

		try {
			const fullPlan = await adapter.buildRunPlan({ fileUri }, reportDir);
			// Запуск через vrunner run --command RunUnitTests=<конфиг>
			assert.strictEqual(fullPlan.tool, 'vrunner');
			assert.strictEqual(fullPlan.args[0], 'run');
			assert.strictEqual(fullPlan.args[1], '--command');
			assert.ok(fullPlan.args[2].startsWith('RunUnitTests='), 'Передаётся параметр RunUnitTests');
			assert.ok(fullPlan.reportTarget, 'Должна быть цель отчёта');
			assert.strictEqual(fullPlan.reportTarget.format, 'junit');

			const fullConfig = JSON.parse(
				await fs.readFile(path.join(reportDir, 'yaxunit-config.json'), 'utf8')
			);
			assert.deepStrictEqual(fullConfig.filter.modules, ['ОМ_Тесты']);
			assert.strictEqual(fullConfig.filter.tests, null);
			assert.strictEqual(fullConfig.reportFormat, 'jUnit');
			assert.strictEqual(fullConfig.closeAfterTests, true);

			const subsetPlan = await adapter.buildRunPlan(
				{ fileUri, caseNames: ['ПроверитьЗапись'] },
				reportDir
			);
			assert.ok(subsetPlan.args.some((arg) => arg.startsWith('RunUnitTests=')));
			const subsetConfig = JSON.parse(
				await fs.readFile(path.join(reportDir, 'yaxunit-config.json'), 'utf8')
			);
			assert.deepStrictEqual(subsetConfig.filter.tests, ['ОМ_Тесты.ПроверитьЗапись']);
			assert.strictEqual(subsetConfig.filter.modules, null);
		} finally {
			await fs.rm(reportDir, { recursive: true, force: true });
		}
	});


	test('buildRunPlan: фильтр по имени расширения из раскладки, а не по списку из конфига проекта', async () => {
		invalidateProjectLayout();
		const adapter = new YaxunitAdapter(vrunnerAt(DESIGNER_WORKSPACE));
		const reportDir = await fs.mkdtemp(path.join(os.tmpdir(), 'yaxunit-ext-'));
		// имя расширения в метаданных отличается от имени каталога
		const fileUri = vscode.Uri.file(
			path.join(DESIGNER_WORKSPACE, 'tests', 'cfe', 'Тесты', 'CommonModules', 'ОМ_Тест', 'Ext', 'Module.bsl')
		);

		try {
			await adapter.buildRunPlan({ fileUri }, reportDir);
			const config = JSON.parse(await fs.readFile(path.join(reportDir, 'yaxunit-config.json'), 'utf8'));
			// без этого прогон модуля из другого расширения отфильтровался бы
			// списком extensions из tools/yaxunit.json и дал пустой отчёт
			assert.deepStrictEqual(config.filter.extensions, ['Тесты']);
			assert.deepStrictEqual(config.filter.modules, ['ОМ_Тест']);
		} finally {
			await fs.rm(reportDir, { recursive: true, force: true });
		}
	});

	test('buildRunPlan: у проекта EDT имя расширения берётся из проекта, а не из каталога src', async () => {
		invalidateProjectLayout();
		const adapter = new YaxunitAdapter(vrunnerAt(EDT_WORKSPACE));
		const reportDir = await fs.mkdtemp(path.join(os.tmpdir(), 'yaxunit-edt-'));
		const fileUri = vscode.Uri.file(
			path.join(EDT_WORKSPACE, 'tests', 'cfe', 'yaxunit-test', 'src', 'CommonModules', 'ОМ_Тест', 'Module.bsl')
		);

		try {
			await adapter.buildRunPlan({ fileUri }, reportDir);
			const config = JSON.parse(await fs.readFile(path.join(reportDir, 'yaxunit-config.json'), 'utf8'));
			assert.deepStrictEqual(config.filter.extensions, ['Тесты']);
		} finally {
			await fs.rm(reportDir, { recursive: true, force: true });
		}
	});

	test('поиск идёт и по расширениям решения, и по тестовым', async () => {
		invalidateProjectLayout();
		const adapter = new YaxunitAdapter(vrunnerAt(DESIGNER_WORKSPACE));

		const globs = await adapter.getIncludeGlobs();

		// расширение с тестами держат отдельно от поставки: без второго корня
		// панель тестирования перестала бы видеть тесты после переноса
		assert.deepStrictEqual(globs, [
			'src/cfe/МоёРасширение/CommonModules/*/Ext/Module.bsl',
			'src/cfe/подмодуль/src/cfe/Вложенное/CommonModules/*/Ext/Module.bsl',
			'tests/cfe/Тесты/CommonModules/*/Ext/Module.bsl',
		]);
	});
});

suite('yaxunitAdapter: раскладка EDT', () => {
	test('модули ищутся в проекте конфигурации, в её расширениях и в тестовых проектах', async () => {
		invalidateProjectLayout();
		const adapter = new YaxunitAdapter(vrunnerAt(EDT_WORKSPACE));

		const globs = await adapter.getIncludeGlobs();

		assert.deepStrictEqual(globs, [
			'ssl31/src/CommonModules/*/Module.bsl',
			'ssl31._ДемоРасширение/src/CommonModules/*/Module.bsl',
			'tests/cfe/yaxunit-test/src/CommonModules/*/Module.bsl',
		]);
	});
});
