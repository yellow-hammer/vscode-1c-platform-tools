import * as assert from 'node:assert';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import {
	baseProjectOfManifest,
	designerExternalsUnder,
	edtBaseProjectOf,
	edtExternalProjectsOf,
	edtProjectOfExternal,
	edtStagingTarget,
	edtToolingRefusal,
	planEdtBridge,
	sourceFormatOfDirectory,
	withBaseProject,
} from '../../features/edt/edtSourceBridge';
import { edtProjectName } from '../../features/edt/edtRunner';
import { invalidateProjectLayout, resolveProjectLayout, setLayoutExclusions } from '../../shared/projectLayout';
import { parseVRunnerVersion, type VRunnerVersion } from '../../shared/vrunnerVersion';

const version = (raw: string): VRunnerVersion => parseVRunnerVersion(raw) as VRunnerVersion;

/** Рабочие области с исходным кодом в обоих форматах. */
const FIXTURES = path.resolve(__dirname, '../../../src/test/fixtures/projectLayout');
const DESIGNER_WORKSPACE = path.join(FIXTURES, 'designer');
const EDT_WORKSPACE = path.join(FIXTURES, 'edt-workspace');
const MIXED_WORKSPACE = path.join(FIXTURES, 'mixed-externals');

/** Активная конфигурация в формате EDT. */
const edtSource = { format: 'edt' as const, dir: 'ssl31' };
const layout = { buildDir: 'build' };

suite('мост между проектом EDT и раннером', () => {
	setup(() => {
		setLayoutExclusions(() => []);
		invalidateProjectLayout();
	});

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
		// Прошлая выгрузка иначе ушла бы в проект вместе с новой
		assert.deepStrictEqual(plan?.exports, [{ clear: 'build/edt-export/ssl31' }]);
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

	test('манифест внешнего объекта получает базовый проект первой строкой', () => {
		assert.strictEqual(
			withBaseProject('Runtime-Version: 8.3.10\nManifest-Version: 1.0\n', 'ssl31'),
			'Base-Project: ssl31\nRuntime-Version: 8.3.10\nManifest-Version: 1.0\n'
		);
		assert.strictEqual(
			withBaseProject('Runtime-Version: 8.3.10\r\nManifest-Version: 1.0\r\n', 'ssl31'),
			'Base-Project: ssl31\r\nRuntime-Version: 8.3.10\r\nManifest-Version: 1.0\r\n'
		);
		const kept = 'Base-Project: другой\nRuntime-Version: 8.3.10\n';
		assert.strictEqual(withBaseProject(kept, 'ssl31'), kept);
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
		// Объекты выгрузки конфигуратора из того же каталога идут в промежуточный каталог рядом с выгрузками проектов
		assert.deepStrictEqual(plan?.exports, [
			{ designerSource: 'src/epf', target: 'build/edt-export/epf' },
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

		assert.deepStrictEqual(plan?.exports, [{ clear: 'build/edt-export/epf' }]);
		assert.deepStrictEqual(plan?.imports, [
			{ source: 'build/edt-export/epf', projectDir: 'src/epf', needsBase: false, external: true },
		]);
	});

	test('проекты внешних объектов в корне рабочей области получают свой промежуточный каталог', () => {
		assert.strictEqual(edtStagingTarget('build', '.'), 'build/edt-export/workspace');
		assert.strictEqual(edtStagingTarget('build', 'dp'), 'build/edt-export/dp');
		assert.strictEqual(edtStagingTarget('build', 'src\\epf'), 'build/edt-export/epf');

		const plan = planEdtBridge({ kind: 'epf.decompile', input: 'build/epf', out: '.' }, { format: 'edt', dir: '.' }, layout);

		assert.deepStrictEqual(plan?.intent, { kind: 'epf.decompile', input: 'build/epf', out: 'build/edt-export/workspace' });
		assert.deepStrictEqual(plan?.imports, [
			{ source: 'build/edt-export/workspace', projectDir: '.', needsBase: false, external: true },
		]);
	});

	test('базовый проект берётся из манифеста, затем по имени проекта, затем у активной конфигурации', () => {
		const at = (...parts: string[]) => path.join(EDT_WORKSPACE, ...parts);
		const lookup = { configurations: [at('ssl31'), at('учёт')], projectName: edtProjectName, active: at('ssl31') };

		// Манифест называет проект его именем в EDT, а не каталогом
		assert.strictEqual(edtBaseProjectOf(at('учёт.РасширениеУчёта'), lookup), at('учёт'));
		assert.strictEqual(edtBaseProjectOf(at('tests', 'cfe', 'yaxunit-test'), { ...lookup, active: at('учёт') }), at('ssl31'));
		// Без манифеста расширение выдаёт себя именем каталога <конфигурация>.<расширение>
		assert.strictEqual(edtBaseProjectOf(at('ssl31._ДемоРасширение'), { ...lookup, active: at('учёт') }), at('ssl31'));
		// Проект внешних объектов ни на кого не ссылается: базовым служит активная конфигурация
		assert.strictEqual(edtBaseProjectOf(at('dp'), { ...lookup, active: at('учёт') }), at('учёт'));
		assert.strictEqual(edtBaseProjectOf(at('dp'), { ...lookup, active: undefined }), undefined);
		assert.strictEqual(edtBaseProjectOf(at('ssl31'), lookup), undefined);

		assert.strictEqual(baseProjectOfManifest('Runtime-Version: 8.3.24\r\nBase-Project: Основа\r\n'), 'Основа');
		assert.strictEqual(baseProjectOfManifest('Runtime-Version: 8.3.24\n'), undefined);
	});

	test('внешний объект знает свой проект EDT по имени', async () => {
		const found = await resolveProjectLayout(EDT_WORKSPACE);

		assert.strictEqual(edtProjectOfExternal(found, 'ТестоваяВнешняяОбработка')?.dir, path.join(EDT_WORKSPACE, 'dp'));
		assert.strictEqual(edtProjectOfExternal(found, 'ТестовыйВнешнийОтчет')?.kind, 'report');
		assert.strictEqual(
			edtProjectOfExternal(found, 'Тесты_Арифметика')?.dir,
			path.join(EDT_WORKSPACE, 'tests', 'epf', 'Тесты_Арифметика')
		);
		assert.strictEqual(edtProjectOfExternal(found, 'Нет'), undefined);
	});

	test('объекты выгрузки конфигуратора берутся из каталога команды по его виду', async () => {
		const designer = await resolveProjectLayout(DESIGNER_WORKSPACE);
		const names = (dir: string) => designerExternalsUnder(designer, DESIGNER_WORKSPACE, dir).map((root) => root.name).sort();

		assert.deepStrictEqual(names('src/epf'), ['ПечатьСчёта']);
		assert.deepStrictEqual(names('src/erf'), ['ОстаткиТоваров', 'ОтчётПоОстаткам']);
		// Рабочая область как каталог: объекты решения без тестовых
		assert.deepStrictEqual(names('.'), ['ОстаткиТоваров', 'ОтчётПоОстаткам', 'ПечатьСчёта']);
		assert.deepStrictEqual(names('tests/epf'), ['Тесты_Арифметика']);

		const mixed = await resolveProjectLayout(MIXED_WORKSPACE);
		assert.deepStrictEqual(
			designerExternalsUnder(mixed, MIXED_WORKSPACE, 'src/epf').map((root) => root.dir),
			[path.join(MIXED_WORKSPACE, 'src', 'epf', 'Печать')]
		);
		assert.deepStrictEqual(designerExternalsUnder(await resolveProjectLayout(EDT_WORKSPACE), EDT_WORKSPACE, '.'), []);
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

			// в одном проекте живут и обработка, и отчёт: команде нужны оба
			const second = path.join(root, 'src', 'epf', 'Отчет', 'src', 'ExternalDataProcessors', 'Выгрузка');
			fs.mkdirSync(second, { recursive: true });
			fs.writeFileSync(path.join(second, 'Выгрузка.mdo'), '<mdclass:ExternalDataProcessor/>');
			assert.deepStrictEqual(edtExternalProjectsOf(root, 'src/epf/Отчет'), [
				{ name: 'Выгрузка', projectDir: 'src/epf/Отчет' },
				{ name: 'Отчет', projectDir: 'src/epf/Отчет' },
			]);
			assert.deepStrictEqual(edtExternalProjectsOf(root, 'src/epf/Отчет/src/ExternalReports/Отчет'), [
				{ name: 'Отчет', projectDir: 'src/epf/Отчет' },
			]);
		} finally {
			fs.rmSync(root, { recursive: true, force: true });
		}
	});
});
