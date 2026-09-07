import * as assert from 'node:assert';
import * as path from 'node:path';
import { scanArtifacts, type Artifact } from '../features/artifacts/artifactsScanner';
import { invalidateProjectLayout, setLayoutExclusions } from '../shared/projectLayout';

/** Рабочие области с исходным кодом в обоих форматах. */
const FIXTURES = path.resolve(__dirname, '../../src/test/fixtures/projectLayout');
const DESIGNER_WORKSPACE = path.join(FIXTURES, 'designer');
const EDT_WORKSPACE = path.join(FIXTURES, 'edt-workspace');

const names = (artifacts: Artifact[]) => artifacts.map((artifact) => `${artifact.kind}:${artifact.name}`).sort();
const tail = (file: string | undefined, segments: number) => (file ?? '').split(path.sep).slice(-segments).join('/');

suite('артефакты: скан рабочей области', () => {
	setup(() => {
		setLayoutExclusions(() => []);
		invalidateProjectLayout();
	});

	test('выгрузка конфигуратора: исходный код из раскладки, собранные файлы поиском', async function () {
		this.timeout(60_000);
		const result = await scanArtifacts(undefined, [DESIGNER_WORKSPACE]);

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
		const result = await scanArtifacts(undefined, [EDT_WORKSPACE]);

		assert.deepStrictEqual(names(result.configurations), ['source:БиблиотекаСтандартныхПодсистемДемо', 'source:УчётДемо'].sort());
		assert.deepStrictEqual(names(result.extensions), ['source:_ДемоРасширение', 'source:РасширениеУчёта', 'source:Тесты'].sort());
		assert.deepStrictEqual(names(result.processors), ['source:ТестоваяВнешняяОбработка', 'source:Тесты_Арифметика'].sort());
		assert.deepStrictEqual(names(result.reports), ['source:ТестовыйВнешнийОтчет']);
		assert.ok(result.extensions.every((artifact) => artifact.format === 'edt'));

		const processor = result.processors.find((artifact) => artifact.name === 'ТестоваяВнешняяОбработка');
		assert.strictEqual(tail(processor?.uri.fsPath, 4), 'dp/src/ExternalDataProcessors/ТестоваяВнешняяОбработка');
		assert.strictEqual(tail(processor?.sourceEntryUri?.fsPath, 1), 'ТестоваяВнешняяОбработка.mdo');
	});
});
