import * as assert from 'node:assert/strict';
import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import { loadBspLibraries } from '../../features/metadata/bspLibraries';
import { buildBspRegistration } from '../../features/metadata/bspRegistration';
import { bspExternalVersion } from '../../features/metadata/bspVersions';
import { moduleFile, sourceDirectory } from '../../shared/objectPaths';
import type { SourceFormat, SourceRoot } from '../../shared/projectLayout';

const FIXTURES = path.resolve(__dirname, '../../../src/test/fixtures/bspVersions');

async function placeModule(configuration: SourceRoot, name: string, fixture: string): Promise<void> {
	const relative = moduleFile(configuration.format, 'ОбщийМодуль', name, 'module');
	assert.ok(relative);
	const file = path.join(sourceDirectory(configuration), relative);
	await fs.mkdir(path.dirname(file), { recursive: true });
	await fs.copyFile(path.join(FIXTURES, fixture), file);
}

suite('Версии из модулей БСП', () => {
	for (const report of [true, false]) {
		test(`читает версию из шаблона регистрации ${report ? 'отчёта' : 'обработки'}`, () => {
			const generated = buildBspRegistration({ report, presentation: 'Пример', commandId: 'Пример' });
			assert.equal(bspExternalVersion('\uFEFF' + generated), '1.0');
		});
	}

	test('читает версию возвращаемой структуры из Вставить и конструктора', async () => {
		const [insert, structure] = await Promise.all([
			fs.readFile(path.join(FIXTURES, 'external-insert.bsl'), 'utf8'),
			fs.readFile(path.join(FIXTURES, 'external-structure.bsl'), 'utf8'),
		]);
		assert.equal(bspExternalVersion(insert), '2.3.4');
		assert.equal(bspExternalVersion(structure), '3.0');
	});

	test('пропускает вычисляемое значение и текст вне регистрации', async () => {
		const source = await fs.readFile(path.join(FIXTURES, 'external-unversioned.bsl'), 'utf8');
		assert.equal(bspExternalVersion(source), undefined);
		assert.equal(bspExternalVersion(await fs.readFile(path.join(FIXTURES, 'service-version.bsl'), 'utf8')), undefined);
	});

	for (const format of ['designer', 'edt'] satisfies SourceFormat[]) {
		test(`читает библиотеки конфигурации в формате ${format}`, async () => {
			const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'bsp-libraries-'));
			const configuration = { dir, format, name: 'Приложение', isExtension: false };
			try {
				await Promise.all([
					placeModule(configuration, 'ОбновлениеИнформационнойБазыБСП', 'bsp.bsl'),
					placeModule(configuration, 'ОбновлениеИнформационнойБазыБТС', 'service.bsl'),
					placeModule(configuration, 'ТехнологияСервиса', 'service-version.bsl'),
					placeModule(configuration, 'ОбновлениеИнформационнойБазыПриложения', 'configuration.bsl'),
					placeModule(configuration, 'Лишний', 'service.bsl'),
				]);
				const describe = async () => (await loadBspLibraries(configuration)).map(({ name, version }) => [name, version]);
				assert.deepEqual(await describe(), [['СтандартныеПодсистемы', '3.1.1.109']]);
				await placeModule(configuration, 'ПодсистемыКонфигурацииПереопределяемый', 'registry.bsl');
				assert.deepEqual(await describe(), [
					['СтандартныеПодсистемы', '3.1.1.109'],
					['БиблиотекаТехнологииСервиса', '2.0.11.12'],
				]);
			} finally {
				await fs.rm(dir, { recursive: true, force: true });
			}
		});
	}
});
