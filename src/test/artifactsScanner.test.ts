import * as assert from 'node:assert';
import * as path from 'node:path';
import { scanArtifacts, scanProjectArtifacts, type Artifact } from '../features/artifacts/artifactsScanner';
import { isOutsideScanRoot, projectRelativePath } from '../features/artifacts/projectScan';
import { invalidateProjectLayout, setLayoutExclusions } from '../shared/projectLayout';
import { detectWorkspaceProjects, scanRootsOf } from '../shared/workspaceProjects';

/** Рабочие области с исходным кодом в обоих форматах. */
const FIXTURES = path.resolve(__dirname, '../../src/test/fixtures/projectLayout');
const DESIGNER_WORKSPACE = path.join(FIXTURES, 'designer');
const EDT_WORKSPACE = path.join(FIXTURES, 'edt-workspace');

/** Проект с подпроектом, собранными файлами и зависимостями. */
const PROJECT = path.resolve(__dirname, '../../src/test/fixtures/workspaceScan/проект');
const SUB_PROJECT = path.join(PROJECT, 'подпроект');

/** Проект OneScript: собранный пакет в корне, как его кладёт opm build, и обработка 1С в тестах. */
const ONESCRIPT_PROJECT = path.resolve(__dirname, '../../src/test/fixtures/workspaceScan/пакет');

const names = (artifacts: Artifact[]) => artifacts.map((artifact) => `${artifact.kind}:${artifact.name}`).sort();
const paths = (artifacts: Artifact[]) => artifacts.map((artifact) => artifact.relativePath).sort();
const tail = (file: string | undefined, segments: number) => (file ?? '').split(path.sep).slice(-segments).join('/');

suite('артефакты: скан проектов', () => {
	setup(() => {
		setLayoutExclusions(() => []);
		invalidateProjectLayout();
	});

	test('выгрузка конфигуратора: исходный код из раскладки, собранные файлы поиском', async function () {
		this.timeout(60_000);
		const [result] = await scanArtifacts(undefined, [{ root: DESIGNER_WORKSPACE, excludeDirs: [] }]);

		assert.strictEqual(result.root, DESIGNER_WORKSPACE);
		assert.deepStrictEqual(names(result.configurations), ['binary:1Cv8.cf', 'source:Конфигурация', 'source:Подмодуль'].sort());
		assert.deepStrictEqual(names(result.extensions), ['source:Расширение', 'source:Вложенное', 'source:Тесты'].sort());
		assert.deepStrictEqual(names(result.processors), ['source:ПечатьСчёта', 'source:Тесты_Арифметика'].sort());
		assert.deepStrictEqual(names(result.reports), ['source:ОстаткиТоваров', 'source:ОтчётПоОстаткам'].sort());

		const configuration = result.configurations.find((artifact) => artifact.kind === 'source');
		assert.strictEqual(configuration?.format, 'designer');
		assert.strictEqual(tail(configuration?.sourceEntryUri?.fsPath, 3), 'src/cf/Configuration.xml');
		const processor = result.processors.find((artifact) => artifact.name === 'ПечатьСчёта');
		assert.strictEqual(tail(processor?.uri.fsPath, 2), 'epf/ПечатьСчёта');
		assert.strictEqual(tail(processor?.sourceEntryUri?.fsPath, 1), 'ПечатьСчёта.xml');
	});

	test('проекты EDT: имена из метаданных, внешние объекты каталогами внутри проекта', async function () {
		this.timeout(60_000);
		const [result] = await scanArtifacts(undefined, [{ root: EDT_WORKSPACE, excludeDirs: [] }]);

		assert.deepStrictEqual(names(result.configurations), ['source:БиблиотекаСтандартныхПодсистемДемо', 'source:УчётДемо'].sort());
		assert.deepStrictEqual(names(result.extensions), ['source:_ДемоРасширение', 'source:РасширениеУчёта', 'source:Тесты'].sort());
		assert.deepStrictEqual(names(result.processors), ['source:ТестоваяВнешняяОбработка', 'source:Тесты_Арифметика'].sort());
		assert.deepStrictEqual(names(result.reports), ['source:ТестовыйВнешнийОтчет']);
		assert.ok(result.extensions.every((artifact) => artifact.format === 'edt'));

		const processor = result.processors.find((artifact) => artifact.name === 'ТестоваяВнешняяОбработка');
		assert.strictEqual(tail(processor?.uri.fsPath, 4), 'dp/src/ExternalDataProcessors/ТестоваяВнешняяОбработка');
		assert.strictEqual(tail(processor?.sourceEntryUri?.fsPath, 1), 'ТестоваяВнешняяОбработка.mdo');
	});

	test('подпроект: его артефакты только у него, пути от корня своего проекта', async function () {
		this.timeout(60_000);
		const [project, subProject] = await scanArtifacts(undefined, [
			{ root: PROJECT, excludeDirs: [SUB_PROJECT] },
			{ root: SUB_PROJECT, excludeDirs: [] },
		]);

		assert.strictEqual(project.root, PROJECT);
		assert.deepStrictEqual(names(project.configurations), ['binary:Основная.cf', 'source:Основная']);
		assert.deepStrictEqual(paths(project.configurations), ['release/Основная.cf', 'src/cf']);

		assert.strictEqual(subProject.root, SUB_PROJECT);
		assert.deepStrictEqual(names(subProject.configurations), ['binary:Подпроект.cf', 'source:Подпроект']);
		assert.deepStrictEqual(paths(subProject.configurations), ['release/Подпроект.cf', 'src/cf']);
	});

	test('проект OneScript: только собранные пакеты, конфигурацией 1С не сканируется', async function () {
		this.timeout(60_000);
		const result = await scanProjectArtifacts({ root: ONESCRIPT_PROJECT, excludeDirs: [] }, undefined, 'onescript');

		assert.strictEqual(result.oneScript, true);
		assert.deepStrictEqual(names(result.packages), ['binary:пакет-0.1.0.ospx']);
		assert.deepStrictEqual([...result.configurations, ...result.extensions, ...result.processors, ...result.reports], []);
	});

	test('проект 1С: пакеты OneScript рядом с файлами 1С', async function () {
		this.timeout(60_000);
		const result = await scanProjectArtifacts({ root: ONESCRIPT_PROJECT, excludeDirs: [] }, undefined, 'onec');

		assert.strictEqual(result.oneScript, false);
		assert.deepStrictEqual(names(result.packages), ['binary:пакет-0.1.0.ospx']);
		assert.deepStrictEqual(names(result.processors), ['binary:Печать.epf']);
	});

	test('расширения подпроектов показываются один раз, у подпроекта; репозиторий расширения у проекта', async function () {
		this.timeout(60_000);
		const retail = path.resolve(__dirname, '../../src/test/fixtures/workspaceProjects/розница');
		const snapshot = await detectWorkspaceProjects([{ name: 'розница', root: retail }]);
		const results = await scanArtifacts(undefined, scanRootsOf(snapshot, [{ name: 'розница', root: retail }]));

		assert.deepStrictEqual(
			results.map((result) => [path.basename(result.root), names(result.extensions)]),
			[
				['розница', ['source:Адаптер', 'source:Доработки']],
				['менеджер-пакетов', ['source:МенеджерПакетов', 'source:ТестыМенеджераПакетов']],
				['метрики', ['source:КлиентМетрик']],
				['экспорт', ['source:ЭкспортМетрик']],
			]
		);
	});
});

suite('артефакты: каталоги проекта', () => {
	const root = path.resolve('/work/build/проект');

	test('исключённые сегменты сравниваются только ниже корня проекта', () => {
		const file = path.join(root, 'release', 'Основная.cf');
		assert.strictEqual(isOutsideScanRoot({ root, excludeDirs: [] }, file, ['build']), false);
		assert.strictEqual(isOutsideScanRoot({ root, excludeDirs: [] }, path.join(root, 'build', 'x.cf'), ['build']), true);
	});

	test('подпроект и путь вне корня проекту не принадлежат', () => {
		const sub = path.join(root, 'подпроект');
		assert.strictEqual(isOutsideScanRoot({ root, excludeDirs: [sub] }, path.join(sub, 'x.cf'), []), true);
		assert.strictEqual(isOutsideScanRoot({ root, excludeDirs: [sub] }, path.join(root, 'подпроект-2', 'x.cf'), []), false);
		assert.strictEqual(isOutsideScanRoot({ root, excludeDirs: [] }, path.resolve('/work/другой/x.cf'), []), true);
	});

	test('путь от корня проекта через косую черту', () => {
		assert.strictEqual(projectRelativePath(root, root), '.');
		assert.strictEqual(projectRelativePath(root, path.join(root, 'src', 'cf')), 'src/cf');
	});
});
