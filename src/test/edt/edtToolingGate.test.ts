import * as assert from 'node:assert';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { edtToolingRefusal, sourceFormatOfDirectory } from '../../features/edt/edtToolingGate';
import { parseVRunnerVersion, type VRunnerVersion } from '../../shared/vrunnerVersion';

const version = (raw: string): VRunnerVersion => parseVRunnerVersion(raw) as VRunnerVersion;

/** Активная конфигурация в формате EDT. */
const edtSource = { format: 'edt' as const, dir: 'ssl31' };

suite('готовность инструментов к исходникам EDT', () => {
	test('раннер до 3.0.0-rc8 не берёт исходники EDT', () => {
		const refusal = edtToolingRefusal(
			{ kind: 'cf.loadFromSrc', src: 'ssl31', updateDb: false },
			edtSource,
			version('2.6.1')
		);

		assert.ok(refusal?.includes('3.0.0-rc8'));
	});

	test('раннер 3.0.0-rc8 и новее исходники EDT берёт', () => {
		for (const raw of ['3.0.0-rc8', '3.0.0-rc9', '3.1.0']) {
			const refusal = edtToolingRefusal({ kind: 'infobase.init', src: 'ssl31' }, edtSource, version(raw));

			assert.strictEqual(refusal, undefined, raw);
		}
	});

	test('исходники конфигуратора командам не мешают', () => {
		const refusal = edtToolingRefusal(
			{ kind: 'cf.loadFromSrc', src: 'src/cf', updateDb: false },
			{ format: 'designer', dir: 'src/cf' },
			version('2.6.1')
		);

		assert.strictEqual(refusal, undefined);
	});

	test('внешние обработки EDT отклоняются в любой версии', () => {
		const refusal = edtToolingRefusal(
			{ kind: 'epf.build', src: 'tests/epf', out: 'build/out' },
			edtSource,
			version('3.1.0')
		);

		assert.ok(refusal?.includes('Внешние обработки'));
	});

	test('разборка в каталог проекта EDT отклоняется', () => {
		const refusal = edtToolingRefusal(
			{ kind: 'cf.decompileFile', file: 'build/out/1Cv8.cf', out: 'ssl31' },
			edtSource,
			version('3.1.0')
		);

		assert.ok(refusal?.includes('другой каталог'));
	});

	test('разборка в другой каталог разрешена', () => {
		const refusal = edtToolingRefusal(
			{ kind: 'cf.decompileFile', file: 'build/out/1Cv8.cf', out: 'src/cf' },
			edtSource,
			version('3.1.0')
		);

		assert.strictEqual(refusal, undefined);
	});

	test('без версии раннера команду не останавливаем', () => {
		// Версию не определили: пусть раннер сам скажет, если не справится
		const refusal = edtToolingRefusal({ kind: 'cf.dumpIbToSrc', out: 'ssl31' }, edtSource, undefined);

		assert.strictEqual(refusal, undefined);
	});

	test('команды над базой формата не касаются', () => {
		const refusal = edtToolingRefusal({ kind: 'infobase.updateDb' }, edtSource, version('2.6.1'));

		assert.strictEqual(refusal, undefined);
	});

	test('формат каталога обработок виден по файлам описаний', () => {
		const root = fs.mkdtempSync(path.join(os.tmpdir(), 'edt-gate-'));
		try {
			// Разложенная раннером обработка: описание в .xml рядом с каталогом
			const designer = path.join(root, 'tests', 'epf', 'Тест');
			fs.mkdirSync(designer, { recursive: true });
			fs.writeFileSync(path.join(root, 'tests', 'epf', 'Тест.xml'), '<MetaDataObject/>');
			// Обработка в проекте EDT: описание глубже, в src/ExternalDataProcessors
			const edt = path.join(root, 'edt', 'src', 'ExternalDataProcessors', 'Тест');
			fs.mkdirSync(edt, { recursive: true });
			fs.writeFileSync(path.join(edt, 'Тест.mdo'), '<mdclass:ExternalDataProcessor/>');
			fs.mkdirSync(path.join(root, 'пусто'));

			assert.strictEqual(sourceFormatOfDirectory(path.join(root, 'tests', 'epf')), 'designer');
			assert.strictEqual(sourceFormatOfDirectory(path.join(root, 'edt')), 'edt');
			assert.strictEqual(sourceFormatOfDirectory(path.join(root, 'пусто')), undefined);
			assert.strictEqual(sourceFormatOfDirectory(path.join(root, 'нет')), undefined);
		} finally {
			fs.rmSync(root, { recursive: true, force: true });
		}
	});
});
