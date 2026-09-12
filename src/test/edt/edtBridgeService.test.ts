import * as assert from 'node:assert';
import * as path from 'node:path';
import { planEdtExternalBuild } from '../../features/edt/edtBridgeService';
import { initActiveConfiguration, setActiveConfiguration } from '../../shared/activeConfiguration';
import { invalidateProjectLayout } from '../../shared/projectLayout';

/** Рабочие области с исходным кодом в обоих форматах. */
const FIXTURES = path.resolve(__dirname, '../../../src/test/fixtures/projectLayout');
const EDT_WORKSPACE = path.join(FIXTURES, 'edt-workspace');
const DESIGNER_WORKSPACE = path.join(FIXTURES, 'designer');

/** Каталог сборки тестовых обработок, как его задаёт адаптер. */
const OUT = path.join('build/out', 'tests', 'epf');

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

suite('мост EDT для сборки обработок из панели тестирования', () => {
	setup(async () => {
		invalidateProjectLayout();
		initActiveConfiguration(memoryContext() as never);
		await setActiveConfiguration(undefined);
	});

	test('обработка из проекта EDT: выгрузка проекта и сборка выгрузки под базовым проектом', async () => {
		const objectDir = path.join(
			EDT_WORKSPACE, 'tests', 'epf', 'Тесты_Арифметика', 'src', 'ExternalDataProcessors', 'Тесты_Арифметика'
		);

		const bridge = await planEdtExternalBuild(EDT_WORKSPACE, 'build/out', { kind: 'epf.build', src: objectDir, out: OUT });

		assert.deepStrictEqual(bridge?.intent, { kind: 'epf.build', src: 'build/out/edt-export/Тесты_Арифметика', out: OUT });
		// Проект выгружается под своим базовым проектом: у тестовой обработки это активная конфигурация
		const exports = (bridge?.exports ?? []).filter((step) => 'projectDir' in step);
		assert.deepStrictEqual(exports, [
			{
				projectDir: 'tests/epf/Тесты_Арифметика',
				target: 'build/out/edt-export/Тесты_Арифметика/Тесты_Арифметика',
				externalName: 'Тесты_Арифметика',
				baseProjectDir: 'ssl31',
			},
		]);
		assert.deepStrictEqual(bridge?.context, { workspaceRoot: EDT_WORKSPACE, buildDir: 'build/out' });
	});

	test('каталог проекта относительно рабочей области даёт тот же план', async () => {
		const bridge = await planEdtExternalBuild(EDT_WORKSPACE, 'build/out', {
			kind: 'epf.build',
			src: 'tests/epf/Тесты_Арифметика',
			out: OUT,
		});

		const projects = (bridge?.exports ?? []).flatMap((step) => ('projectDir' in step ? [step.projectDir] : []));
		assert.deepStrictEqual(projects, ['tests/epf/Тесты_Арифметика']);
	});

	test('обработка вне проекта EDT идёт к раннеру как есть', async () => {
		const designer = path.join(DESIGNER_WORKSPACE, 'tests', 'epf', 'Тесты_Арифметика');

		assert.strictEqual(
			await planEdtExternalBuild(DESIGNER_WORKSPACE, 'build/out', { kind: 'epf.build', src: designer, out: OUT }),
			undefined
		);
	});
});
