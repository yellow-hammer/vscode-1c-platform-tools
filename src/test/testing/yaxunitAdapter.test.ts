import * as assert from 'node:assert';
import * as os from 'node:os';
import * as path from 'node:path';
import * as fs from 'node:fs/promises';
import * as vscode from 'vscode';
import { VRunnerManager } from '../../shared/vrunnerManager';
import { YaxunitAdapter, extractModuleName } from '../../features/testing/adapters/yaxunitAdapter';

suite('yaxunitAdapter', () => {
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
});
