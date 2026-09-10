import * as assert from 'node:assert';
import * as path from 'node:path';
import { activeExternalGlobBases, activeSourceGlobBases } from '../../features/testing/adapters/adapterUtils';
import { initActiveConfiguration, setActiveConfiguration } from '../../shared/activeConfiguration';
import { invalidateProjectLayout } from '../../shared/projectLayout';
import type { VRunnerManager } from '../../shared/vrunnerManager';

/** Рабочая область с проектами EDT. */
const EDT_WORKSPACE = path.resolve(__dirname, '../../../src/test/fixtures/projectLayout/edt-workspace');

/** Менеджер vrunner с корнем в фикстуре и путями по умолчанию. */
function vrunnerAt(workspaceRoot: string): VRunnerManager {
	return {
		getWorkspaceRoot: () => workspaceRoot,
		getCfPath: () => 'src/cf',
		getCfePath: () => 'src/cfe',
		getTestsCfePath: () => 'tests/cfe',
	} as unknown as VRunnerManager;
}

/** Хранилище выбора конфигурации в памяти. */
function memoryContext(): unknown {
	const values = new Map<string, unknown>();
	return {
		workspaceState: {
			get: (key: string) => values.get(key),
			update: async (key: string, value: unknown) => {
				values.set(key, value);
			},
			keys: () => [...values.keys()],
		},
	};
}

suite('базы поиска тестов в раскладке EDT', () => {
	setup(async () => {
		invalidateProjectLayout();
		initActiveConfiguration(memoryContext() as never);
		await setActiveConfiguration(undefined);
	});

	test('базы берутся у активной конфигурации и её расширений', async () => {
		const bases = await activeSourceGlobBases(vrunnerAt(EDT_WORKSPACE));

		assert.deepStrictEqual(bases.sort(), ['ssl31', 'ssl31._ДемоРасширение'].sort());
	});

	test('смена конфигурации меняет базы поиска', async () => {
		await setActiveConfiguration(path.join(EDT_WORKSPACE, 'учёт'));

		const bases = await activeSourceGlobBases(vrunnerAt(EDT_WORKSPACE));

		assert.deepStrictEqual(bases.sort(), ['учёт', 'учёт.РасширениеУчёта'].sort());
	});

	test('проекты с внешними обработками отдаются отдельно', async () => {
		const bases = await activeExternalGlobBases(vrunnerAt(EDT_WORKSPACE));

		assert.deepStrictEqual(bases, ['dp']);
	});

	test('в раскладке конфигуратора баз проектов нет', async () => {
		const designer = path.resolve(__dirname, '../../../src/test/fixtures/projectLayout/designer');

		assert.deepStrictEqual(await activeSourceGlobBases(vrunnerAt(designer)), []);
	});
});
