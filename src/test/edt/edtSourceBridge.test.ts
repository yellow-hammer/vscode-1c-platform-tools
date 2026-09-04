import * as assert from 'node:assert';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import {
	edtExternalProjectsOf,
	edtToolingRefusal,
	planEdtBridge,
	sourceFormatOfDirectory,
} from '../../features/edt/edtSourceBridge';
import { parseVRunnerVersion, type VRunnerVersion } from '../../shared/vrunnerVersion';

const version = (raw: string): VRunnerVersion => parseVRunnerVersion(raw) as VRunnerVersion;

/** Активная конфигурация в формате EDT. */
const edtSource = { format: 'edt' as const, dir: 'ssl31' };
const layout = { buildDir: 'build' };

suite('мост между проектом EDT и раннером', () => {
	test('загрузка из проекта идёт из его выгрузки', () => {
		const plan = planEdtBridge({ kind: 'cf.loadFromSrc', src: 'ssl31', updateDb: false }, edtSource, layout);

		assert.deepStrictEqual(plan?.intent, { kind: 'cf.loadFromSrc', src: 'build/edt-export/ssl31', updateDb: false });
		assert.deepStrictEqual(plan?.exports, [{ projectDir: 'ssl31', target: 'build/edt-export/ssl31' }]);
		assert.deepStrictEqual(plan?.imports, []);
	});

	test('создание базы и сборка cf выгружают проект перед командой', () => {
		for (const intent of [
			{ kind: 'infobase.init' as const, src: 'ssl31' },
			{ kind: 'cf.build' as const, src: 'ssl31', out: 'build/out/1Cv8.cf' },
		]) {
			const plan = planEdtBridge(intent, edtSource, layout);
			assert.strictEqual(plan?.exports.length, 1, intent.kind);
			assert.strictEqual((plan?.intent as { src: string }).src, 'build/edt-export/ssl31', intent.kind);
		}
	});

	test('выгрузка из базы уходит в проект импортом', () => {
		const plan = planEdtBridge({ kind: 'cf.dumpIbToSrc', out: 'ssl31' }, edtSource, layout);

		assert.deepStrictEqual(plan?.intent, { kind: 'cf.dumpIbToSrc', out: 'build/edt-export/ssl31' });
		assert.deepStrictEqual(plan?.exports, []);
		assert.deepStrictEqual(plan?.imports, [
			{ source: 'build/edt-export/ssl31', projectDir: 'ssl31', needsBase: false, external: false },
		]);
	});

	test('расширению при импорте нужен базовый проект', () => {
		const extension = { format: 'edt' as const, dir: 'ssl31._ДемоРасширение' };
		const plan = planEdtBridge(
			{ kind: 'cfe.dumpIbToSrc', extensionName: '_ДемоРасширение', out: 'ssl31._ДемоРасширение' },
			extension,
			layout
		);

		assert.deepStrictEqual(plan?.imports, [
			{
				source: 'build/edt-export/ssl31._ДемоРасширение',
				projectDir: 'ssl31._ДемоРасширение',
				needsBase: true,
				external: false,
			},
		]);
	});

	test('разборка cf в каталог проекта проходит через импорт', () => {
		const plan = planEdtBridge({ kind: 'cf.decompileFile', file: 'build/out/1Cv8.cf', out: 'ssl31' }, edtSource, layout);

		assert.strictEqual((plan?.intent as { out: string }).out, 'build/edt-export/ssl31');
		assert.strictEqual(plan?.imports[0]?.projectDir, 'ssl31');
	});

	test('обработки собираются из выгрузок своих проектов', () => {
		const plan = planEdtBridge(
			{ kind: 'epf.build', src: 'src/epf', out: 'build/epf' },
			{ format: 'edt', dir: 'src/epf' },
			{
				buildDir: 'build',
				externalProjects: [
					{ name: 'Загрузка', projectDir: 'src/epf/Загрузка' },
					{ name: 'Отчет', projectDir: 'src/epf/Отчет' },
				],
			}
		);

		assert.deepStrictEqual(plan?.intent, { kind: 'epf.build', src: 'build/edt-export/epf', out: 'build/epf' });
		assert.deepStrictEqual(plan?.exports, [
			{ projectDir: 'src/epf/Загрузка', target: 'build/edt-export/epf/Загрузка', externalName: 'Загрузка' },
			{ projectDir: 'src/epf/Отчет', target: 'build/edt-export/epf/Отчет', externalName: 'Отчет' },
		]);
	});

	test('разборка обработок раскладывается по проектам', () => {
		const plan = planEdtBridge(
			{ kind: 'epf.decompile', input: 'build/epf', out: 'src/epf' },
			{ format: 'edt', dir: 'src/epf' },
			layout
		);

		assert.deepStrictEqual(plan?.imports, [
			{ source: 'build/edt-export/epf', projectDir: 'src/epf', needsBase: true, external: true },
		]);
	});

	test('исходники конфигуратора и команды над базой идут к раннеру как есть', () => {
		assert.strictEqual(
			planEdtBridge({ kind: 'cf.loadFromSrc', src: 'src/cf', updateDb: false }, { format: 'designer', dir: 'src/cf' }, layout),
			undefined
		);
		assert.strictEqual(planEdtBridge({ kind: 'infobase.updateDb' }, edtSource, layout), undefined);
		assert.strictEqual(planEdtBridge({ kind: 'test.xunit' }, edtSource, layout), undefined);
	});

	test('конвертацию раннером останавливает только старый раннер', () => {
		const convert = { kind: 'cf.convert' as const, src: 'ssl31', out: 'src/cf' };
		assert.ok(edtToolingRefusal(convert, edtSource, version('2.6.1'))?.includes('3.0.0-rc8'));
		assert.strictEqual(edtToolingRefusal(convert, edtSource, version('3.0.0-rc8')), undefined);
		assert.strictEqual(edtToolingRefusal(convert, edtSource, undefined), undefined);
		assert.strictEqual(
			edtToolingRefusal({ kind: 'cf.loadFromSrc', src: 'ssl31', updateDb: false }, edtSource, version('2.6.1')),
			undefined
		);
	});

	test('формат каталога обработок виден по файлам описаний', () => {
		const root = fs.mkdtempSync(path.join(os.tmpdir(), 'edt-bridge-'));
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

	test('проекты внешних объектов находятся по каталогу объекта, проекту и их корню', () => {
		const root = fs.mkdtempSync(path.join(os.tmpdir(), 'edt-bridge-'));
		try {
			for (const [project, kind, name] of [
				['Загрузка', 'ExternalDataProcessors', 'Загрузка'],
				['Отчет', 'ExternalReports', 'Отчет'],
			]) {
				const objectDir = path.join(root, 'src', 'epf', project, 'src', kind, name);
				fs.mkdirSync(objectDir, { recursive: true });
				fs.writeFileSync(path.join(root, 'src', 'epf', project, '.project'), '<projectDescription/>');
				fs.writeFileSync(path.join(objectDir, `${name}.mdo`), '<mdclass:ExternalDataProcessor/>');
			}
			fs.mkdirSync(path.join(root, 'src', 'epf', 'мусор'));

			assert.deepStrictEqual(edtExternalProjectsOf(root, 'src/epf'), [
				{ name: 'Загрузка', projectDir: 'src/epf/Загрузка' },
				{ name: 'Отчет', projectDir: 'src/epf/Отчет' },
			]);
			assert.deepStrictEqual(edtExternalProjectsOf(root, 'src/epf/Отчет'), [{ name: 'Отчет', projectDir: 'src/epf/Отчет' }]);
			assert.deepStrictEqual(edtExternalProjectsOf(root, 'src/epf/Отчет/src/ExternalReports/Отчет'), [
				{ name: 'Отчет', projectDir: 'src/epf/Отчет' },
			]);
		} finally {
			fs.rmSync(root, { recursive: true, force: true });
		}
	});
});
