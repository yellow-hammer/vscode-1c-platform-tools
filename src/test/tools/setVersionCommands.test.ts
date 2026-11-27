import * as assert from 'node:assert/strict';
import * as path from 'node:path';
import * as vscode from 'vscode';
import { SetVersionCommands } from '../../commands/setVersionCommands';
import type { SourceVersionTarget } from '../../features/metadata/sourceVersions';
import { runWithProject } from '../../shared/workspaceProjects';

const fixtures = path.resolve(__dirname, '../../../src/test/fixtures/projectLayout');

suite('установка версии внешних объектов', () => {
	const window = vscode.window as {
		showQuickPick: (items: vscode.QuickPickItem[], options: vscode.QuickPickOptions) =>
			Thenable<readonly vscode.QuickPickItem[] | undefined>;
	};
	const originalQuickPick = window.showQuickPick;
	const writes: { root: string; targets: SourceVersionTarget[] }[] = [];
	const commands = new SetVersionCommands({} as vscode.ExtensionContext, async (_context, root, targets) => {
		writes.push({ root, targets });
	});

	setup(() => { writes.length = 0; });
	teardown(() => { window.showQuickPick = originalQuickPick; });

	for (const example of [
		{
			kind: 'отчётов', fixture: 'designer', run: () => commands.setVersionReport(), modules: {
				'ОтчётПоОстаткам': 'src/erf/ОтчётПоОстаткам/ОстаткиПоСкладам/Ext/ObjectModule.bsl',
				'ОстаткиТоваров': 'src/erf/ОстаткиТоваров/ОстаткиТоваров/Ext/ObjectModule.bsl',
			},
		},
		{
			kind: 'обработок', fixture: 'mixed-externals', run: () => commands.setVersionProcessor(), modules: {
				'Загрузка': 'src/epf/Загрузка/src/ExternalDataProcessors/Загрузка/ObjectModule.bsl',
				'Печать': 'src/epf/Печать/Печать/Ext/ObjectModule.bsl',
			},
		},
	]) {
		test(`передаёт выбранные модули ${example.kind} одной команде записи`, async () => {
			const root = path.join(fixtures, example.fixture);
			const modules = Object.entries(example.modules);
			window.showQuickPick = async (items, options) => {
				assert.equal(options.canPickMany, true);
				assert.equal(options.matchOnDescription, true);
				assert.deepEqual(items.map(({ label }) => label).sort(), modules.map(([name]) => name).sort());
				return modules.map(([name]) => {
					const item = items.find(({ label }) => label === name);
					assert.ok(item);
					return item;
				});
			};

			await runWithProject(root, example.run);
			assert.deepEqual(writes, [{ root, targets: modules.map(([, file]) => ({
				op: 'bsp-external-version-set', moduleFile: path.join(root, file),
			})) }]);
		});
	}

	test('отмена и пустой выбор не открывают ввод версии', async () => {
		const root = path.join(fixtures, 'designer');
		for (const selection of [undefined, []]) {
			window.showQuickPick = async () => selection;
			await runWithProject(root, () => commands.setVersionReport());
		}
		assert.deepEqual(writes, []);
	});

	test('избранная обработка открывает ввод версии без выбора объекта', async () => {
		const root = path.join(fixtures, 'mixed-externals');
		window.showQuickPick = async () => assert.fail('Имя объекта уже передано команде');
		await runWithProject(root, () => commands.setVersionProcessor('Печать'));
		assert.deepEqual(writes, [{ root, targets: [{
			op: 'bsp-external-version-set', moduleFile: path.join(root, 'src/epf/Печать/Печать/Ext/ObjectModule.bsl'),
		}] }]);
	});
});
