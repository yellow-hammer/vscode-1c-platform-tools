import * as assert from 'node:assert';
import { clickCommand, type ServiceSelection } from '../../features/serviceFiles/serviceFilesTree';
import type { ServiceFileKind, ServiceFileRow } from '../../features/serviceFiles/catalog';

const NOTHING_SELECTED: ServiceSelection = { profile: 'autumn-properties.json', environmentFile: '.env.ci' };

function row(kind: ServiceFileKind, relPath: string, exists = true): ServiceFileRow {
	return { kind, relPath, exists };
}

function click(target: ServiceFileRow, selection = NOTHING_SELECTED): { command?: string; arguments?: unknown[] } {
	const action = clickCommand(target, 'v3', selection);
	return { command: action?.command, arguments: action?.arguments };
}

suite('служебные файлы: щелчок по строке', () => {
	test('профиль, файл Vanessa Runner и окружение выбираются', () => {
		assert.deepStrictEqual(click(row('profile', 'autumn-properties.dev.json')), {
			command: '1c-platform-tools.env.selectProfile',
			arguments: ['dev'],
		});
		assert.deepStrictEqual(click(row('vrunner', 'tools/vrunner.ci.json')), {
			command: '1c-platform-tools.env.selectProfile',
			arguments: ['tools/vrunner.ci.json'],
		});
		assert.deepStrictEqual(click(row('environment', '.env')), {
			command: '1c-platform-tools.env.selectEnvironment',
			arguments: [''],
		});
		assert.deepStrictEqual(click(row('environment', '.env.dev')), {
			command: '1c-platform-tools.env.selectEnvironment',
			arguments: ['dev'],
		});
	});

	test('по выбранной строке щелчок ничего не делает', () => {
		const selection: ServiceSelection = { profile: 'tools/vrunner.ci.json', environmentFile: '.env.ci' };
		assert.strictEqual(clickCommand(row('vrunner', 'tools/vrunner.ci.json'), 'v3', selection), undefined);
		assert.strictEqual(clickCommand(row('environment', '.env.ci'), 'v3', selection), undefined);
	});

	test('где выбирать нечего, щелчок открывает файл', () => {
		assert.strictEqual(click(row('environment', '.env.local')).command, '1c-platform-tools.serviceFiles.ensure');
		assert.strictEqual(click(row('gitignore', '.gitignore')).command, 'vscode.open');
		assert.strictEqual(click(row('packagedef', 'packagedef')).command, 'vscode.open');
		assert.strictEqual(click(row('xunit', 'tools/xUnitParams.json')).command, 'vscode.open');
		assert.strictEqual(click(row('hooks', '.1cpt/hooks.json')).command, '1c-platform-tools.hooks.openEditor');
		assert.strictEqual(click(row('pipelines', '.1cpt/pipelines.json')).command, '1c-platform-tools.pipelines.openEditor');
	});

	test('отсутствующий файл щелчок создаёт, а не выбирает', () => {
		assert.strictEqual(click(row('profile', 'autumn-properties.json', false)).command, '1c-platform-tools.serviceFiles.ensure');
		assert.strictEqual(click(row('environment', '.env', false)).command, '1c-platform-tools.serviceFiles.ensure');
		assert.strictEqual(click(row('vrunner', 'tools/vrunner.json', false)).command, '1c-platform-tools.serviceFiles.createBuildFile');
	});
});