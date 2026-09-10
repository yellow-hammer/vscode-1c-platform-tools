import * as assert from 'node:assert';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { configurationScope, initActiveConfiguration, setActiveConfiguration } from '../../shared/activeConfiguration';
import { invalidateProjectLayout } from '../../shared/projectLayout';

/** Рабочая область с двумя конфигурациями в формате EDT. */
const EDT_WORKSPACE = path.resolve(__dirname, '../../../src/test/fixtures/projectLayout/edt-workspace');

/** Настройки путей проекта по умолчанию. */
const DEFAULT_PATHS = { configuration: 'src/cf', extensions: ['src/cfe'] };

/** Хранилище выбора, как workspaceState. */
function memoryState(): { context: { workspaceState: unknown } } {
	const values = new Map<string, unknown>();
	return {
		context: {
			workspaceState: {
				get: (key: string) => values.get(key),
				update: async (key: string, value: unknown) => {
					if (value === undefined) {
						values.delete(key);
					} else {
						values.set(key, value);
					}
				},
				keys: () => [...values.keys()],
			},
		},
	};
}

suite('активная конфигурация', () => {
	setup(async () => {
		invalidateProjectLayout();
		initActiveConfiguration(memoryState().context as never);
		await setActiveConfiguration(undefined);
	});

	test('без выбора активна первая найденная конфигурация', async () => {
		const scope = await configurationScope(EDT_WORKSPACE, DEFAULT_PATHS);

		assert.strictEqual(scope.configuration?.name, 'БиблиотекаСтандартныхПодсистемДемо');
		assert.deepStrictEqual(
			scope.others.map((root) => root.name),
			['УчётДемо']
		);
	});

	test('выбор задаёт конфигурацию и переносит прежнюю в остальные', async () => {
		await setActiveConfiguration(path.join(EDT_WORKSPACE, 'учёт'));

		const scope = await configurationScope(EDT_WORKSPACE, DEFAULT_PATHS);

		assert.strictEqual(scope.configuration?.name, 'УчётДемо');
		assert.deepStrictEqual(
			scope.others.map((root) => root.name),
			['БиблиотекаСтандартныхПодсистемДемо']
		);
	});

	test('расширения берутся от активной конфигурации', async () => {
		const ssl = await configurationScope(EDT_WORKSPACE, DEFAULT_PATHS);
		assert.deepStrictEqual(
			ssl.extensions.map((root) => root.name),
			['_ДемоРасширение']
		);

		await setActiveConfiguration(path.join(EDT_WORKSPACE, 'учёт'));
		const accounting = await configurationScope(EDT_WORKSPACE, DEFAULT_PATHS);

		assert.deepStrictEqual(
			accounting.extensions.map((root) => root.name),
			['РасширениеУчёта']
		);
	});

	test('выбор несуществующей конфигурации не ломает область работы', async () => {
		await setActiveConfiguration(path.join(EDT_WORKSPACE, 'которой-нет'));

		const scope = await configurationScope(EDT_WORKSPACE, DEFAULT_PATHS);

		assert.strictEqual(scope.configuration?.name, 'БиблиотекаСтандартныхПодсистемДемо');
	});
});

suite('активная конфигурация: расширения вне конвенции', () => {
	setup(async () => {
		invalidateProjectLayout();
		initActiveConfiguration(memoryState().context as never);
		await setActiveConfiguration(undefined);
	});

	test('расширение, не подошедшее ни к одной конфигурации, остаётся видимым', async () => {
		const workspace = fs.mkdtempSync(path.join(os.tmpdir(), '1cpt-scope-'));
		const mdo = (name: string, extension: boolean) =>
			`<?xml version="1.0" encoding="UTF-8"?>\n<mdclass:Configuration xmlns:mdclass="http://g5.1c.ru/v8/dt/metadata/mdclass">\n  <name>${name}</name>\n${extension ? '  <namePrefix>x</namePrefix>\n' : ''}</mdclass:Configuration>\n`;
		for (const [dir, name, isExtension] of [
			['первая', 'Первая', false],
			['вторая', 'Вторая', false],
			['ничьё', 'Ничьё', true],
		] as const) {
			fs.mkdirSync(path.join(workspace, dir, 'src', 'Configuration'), { recursive: true });
			fs.writeFileSync(path.join(workspace, dir, 'src', 'Configuration', 'Configuration.mdo'), mdo(name, isExtension));
		}

		const scope = await configurationScope(workspace);

		assert.strictEqual(scope.others.length, 1, 'вторая конфигурация должна быть в остальных');
		assert.deepStrictEqual(
			scope.extensions.map((extension) => extension.name),
			['Ничьё']
		);
	});
});
