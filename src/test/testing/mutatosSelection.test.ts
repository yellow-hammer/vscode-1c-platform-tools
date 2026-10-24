import * as assert from 'node:assert';
import * as path from 'node:path';
import * as vscode from 'vscode';
import type { AdapterRunPlan, FileTreeLocation, TestFrameworkAdapter } from '../../features/testing/frameworkAdapter';
import { selectionFilters } from '../../features/testing/mutatos/mutatosRun';
import { parseBslTestModule } from '../../features/testing/parsers/bslTestParser';
import type { DiscoveredFile } from '../../features/testing/parsers/parserTypes';
import { TestingController } from '../../features/testing/testController';
import { testingVRunner } from '../fixtures/helpers/testingVRunner';

/** Проект с тестовым набором OneUnit: обычный тест с отображаемым именем и параметризованный. */
const PANEL = path.resolve(__dirname, '../../../src/test/fixtures/mutatos/panel');
const SUITE_FILE = path.join(PANEL, 'tests', '1Проверка.калькулятора.os');

/** Адаптер OneScript, который разбирает наборы так же, как настоящий, и ничего не запускает. */
class OneScriptTests implements TestFrameworkAdapter {
	public readonly id = 'onescript' as const;
	public readonly label = 'OneScript';
	public readonly usesReportDir = false;

	public async isEnabled(): Promise<boolean> {
		return true;
	}

	public getIncludeGlobs(): string[] {
		return ['tests/**/*.os'];
	}

	public parseFile(content: string): DiscoveredFile | undefined {
		return parseBslTestModule(content, 'xunit');
	}

	public describeFileLocation(): FileTreeLocation {
		return { segments: [] };
	}

	public async buildRunPlan(): Promise<AdapterRunPlan> {
		throw new Error('процесс в проверке не запускается');
	}
}

suite('mutatos: отбор по узлу панели тестирования', () => {
	test('файл отбирает набор, кейс ещё и метод, параметризованный кейс свою процедуру', async function () {
		this.timeout(60_000);
		const testing = new TestingController([new OneScriptTests()], testingVRunner(), { current: true }, {
			id: '1c-platform-tools-tests-mutatos-selection',
			scanRootOf: async (root) => ({ root, excludeDirs: [] }),
		});
		const controller = (testing as unknown as { controller: vscode.TestController }).controller;
		try {
			testing.setProject(PANEL);
			await testing.enqueueRebuild();
			const [framework] = [...controller.items].map(([, item]) => item);
			const file = framework?.children.get(`onescript|${vscode.Uri.file(SUITE_FILE).toString()}`);
			assert.ok(file, 'набор не попал в дерево');
			await controller.resolveHandler?.(file);

			assert.deepStrictEqual(testing.oneScriptSelection(file), { root: PANEL, file: SUITE_FILE });
			assert.strictEqual(testing.oneScriptSelection(framework), undefined);
			const cases = [...file.children].map(([, item]) => item);
			assert.deepStrictEqual(
				cases.map((item) => [item.label, testing.oneScriptSelection(item)?.method]),
				[
					['Сложение складывает', 'СложениеСкладывает'],
					['[2]', 'ЧислоПоложительно'],
					['[3]', 'ЧислоПоложительно'],
				]
			);

			const selection = testing.oneScriptSelection(cases[1]);
			assert.ok(selection);
			assert.deepStrictEqual(selectionFilters(selection), ['-s', '^_Проверка_калькулятора$', '-m', '^ЧислоПоложительно$']);
		} finally {
			testing.dispose();
		}
	});
});
