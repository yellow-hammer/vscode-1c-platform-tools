import * as assert from 'node:assert';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import {
	flattenExternalExport,
	planEdtExternalImports,
	replaceExternalObject,
	stageDesignerExternals,
} from '../../features/edt/edtBridgeRunner';
import { readExternalDump } from '../../features/artifacts/externalDump';
import { invalidateProjectLayout, resolveProjectLayout, setLayoutExclusions } from '../../shared/projectLayout';

const FIXTURES = path.resolve(__dirname, '../../../src/test/fixtures');
/** Выгрузка проекта внешних объектов, как её пишет EDT: обработка и отчёт. */
const EXPORT = path.join(FIXTURES, 'edt', 'external-export');
/** Выгрузка одного объекта в раскладке раннера. */
const DUMP = path.join(FIXTURES, 'edt', 'external-dump');
const MIXED_WORKSPACE = path.join(FIXTURES, 'projectLayout', 'mixed-externals');

suite('шаги моста EDT над файлами выгрузок', () => {
	let staging: string;

	setup(() => {
		staging = fs.mkdtempSync(path.join(os.tmpdir(), 'edt-bridge-'));
		setLayoutExclusions(() => []);
		invalidateProjectLayout();
	});

	teardown(() => {
		fs.rmSync(staging, { recursive: true, force: true });
	});

	test('выгрузка одного объекта перекладывается в раскладку раннера, соседи по проекту убираются', async () => {
		fs.cpSync(EXPORT, staging, { recursive: true });

		assert.deepStrictEqual(await flattenExternalExport(staging, 'Загрузка'), ['Загрузка']);
		assert.ok(fs.existsSync(path.join(staging, 'Загрузка.xml')));
		assert.ok(fs.existsSync(path.join(staging, 'Загрузка', 'Ext', 'ObjectModule.bsl')));
		assert.ok(!fs.existsSync(path.join(staging, 'ExternalDataProcessors')));
		assert.ok(!fs.existsSync(path.join(staging, 'ExternalReports')));
		assert.ok(!fs.existsSync(path.join(staging, 'Остатки.xml')));
	});

	test('выгрузка проекта перекладывается целиком', async () => {
		fs.cpSync(EXPORT, staging, { recursive: true });

		assert.deepStrictEqual((await flattenExternalExport(staging)).sort(), ['Загрузка', 'Остатки']);
		assert.ok(fs.existsSync(path.join(staging, 'Загрузка.xml')));
		assert.ok(fs.existsSync(path.join(staging, 'Остатки.xml')));
		assert.ok(fs.existsSync(path.join(staging, 'Остатки', 'Ext', 'ObjectModule.bsl')));
	});

	test('объект в выгрузке проекта подменяется своей новой выгрузкой, остальные объекты остаются', async () => {
		fs.cpSync(EXPORT, staging, { recursive: true });
		await flattenExternalExport(staging);

		await replaceExternalObject(staging, path.join(DUMP, 'Загрузка', 'Загрузка.xml'), 'Загрузка');

		assert.match(fs.readFileSync(path.join(staging, 'Загрузка.xml'), 'utf8'), /новая выгрузка/);
		assert.match(fs.readFileSync(path.join(staging, 'Загрузка', 'Ext', 'ObjectModule.bsl'), 'utf8'), /2\.0\.0\.0/);
		assert.strictEqual(
			fs.readFileSync(path.join(staging, 'Остатки', 'Ext', 'ObjectModule.bsl'), 'utf8'),
			fs.readFileSync(path.join(EXPORT, 'ExternalReports', 'Остатки', 'Ext', 'ObjectModule.bsl'), 'utf8')
		);
	});

	test('импорт EDT подменяет выбранный объект, когда XML назван не как файл разборки', async () => {
		const project = path.join(staging, 'проект');
		const output = path.join(staging, 'выгрузка');
		const dump = path.join(output, 'Загрузка');
		fs.cpSync(EXPORT, project, { recursive: true });
		fs.cpSync(path.join(DUMP, 'Загрузка'), dump, { recursive: true });
		fs.renameSync(path.join(dump, 'Загрузка.xml'), path.join(dump, 'ИмяПлатформы.xml'));
		fs.renameSync(path.join(dump, 'Загрузка'), path.join(dump, 'ИмяПлатформы'));
		await flattenExternalExport(project);

		const descriptor = await readExternalDump(output, 'Загрузка');
		await replaceExternalObject(project, descriptor.descriptor, 'Загрузка');

		assert.match(fs.readFileSync(path.join(project, 'Загрузка.xml'), 'utf8'), /новая выгрузка/);
		assert.match(fs.readFileSync(path.join(project, 'Загрузка', 'Ext', 'ObjectModule.bsl'), 'utf8'), /2\.0\.0\.0/);
		assert.ok(fs.existsSync(path.join(project, 'Остатки.xml')));
	});

	test('пакетная разборка находит проект по имени из XML даже в подкаталоге', async () => {
		const dump = path.join(staging, 'Подкаталог', 'ПриёмФайла');
		fs.cpSync(path.join(DUMP, 'Загрузка'), dump, { recursive: true });
		fs.renameSync(path.join(dump, 'Загрузка.xml'), path.join(dump, 'ИмяПлатформы.xml'));
		fs.renameSync(path.join(dump, 'Загрузка'), path.join(dump, 'ИмяПлатформы'));
		const orphan = path.join(staging, 'БезПроекта');
		fs.mkdirSync(orphan);
		fs.copyFileSync(path.join(EXPORT, 'ExternalReports', 'Остатки.xml'), path.join(orphan, 'Остатки.xml'));
		const layout = await resolveProjectLayout(MIXED_WORKSPACE);
		const project = path.join(MIXED_WORKSPACE, 'src', 'epf', 'Загрузка');

		const { owned, orphans } = await planEdtExternalImports(staging, 'src/epf', layout);

		assert.deepStrictEqual(owned.get(project), [
			{ name: 'Загрузка', kind: 'processor', descriptor: path.join(dump, 'ИмяПлатформы.xml') },
		]);
		assert.deepStrictEqual(orphans, [
			{ name: 'Остатки', kind: 'report', descriptor: path.join(orphan, 'Остатки.xml') },
		]);
	});

	test('точечная разборка EDT проверяет внутреннее имя и вид объекта', async () => {
		const layout = await resolveProjectLayout(MIXED_WORKSPACE);
		const dump = path.join(staging, 'ВыбранныйОбъект');
		fs.cpSync(path.join(DUMP, 'Загрузка'), dump, { recursive: true });
		await assert.rejects(
			planEdtExternalImports(staging, 'ВыбранныйПроект', layout, { name: 'ВыбранныйОбъект', kind: 'processor' }),
			/Файл содержит объект «Загрузка»/
		);
		fs.renameSync(dump, path.join(staging, 'Загрузка'));
		await assert.rejects(
			planEdtExternalImports(staging, 'ВыбранныйПроект', layout, { name: 'Загрузка', kind: 'report' }),
			/Объект «Загрузка» имеет другой вид/
		);
		const { owned, orphans } = await planEdtExternalImports(
			staging, 'ВыбранныйПроект', layout, { name: 'Загрузка', kind: 'processor' }
		);
		assert.deepStrictEqual(owned.get('ВыбранныйПроект'), [
			{ name: 'Загрузка', kind: 'processor', descriptor: path.join(staging, 'Загрузка', 'Загрузка.xml') },
		]);
		assert.deepStrictEqual(orphans, []);
	});

	test('объекты выгрузки конфигуратора рядом с проектами EDT ложатся в промежуточный каталог как есть', async () => {
		const layout = await resolveProjectLayout(MIXED_WORKSPACE);

		const copied = await stageDesignerExternals({ designerSource: 'src/epf', target: staging }, MIXED_WORKSPACE, layout);

		assert.deepStrictEqual(copied, [path.join(staging, 'Печать')]);
		assert.ok(fs.existsSync(path.join(staging, 'Печать', 'Печать.xml')));
		assert.ok(fs.existsSync(path.join(staging, 'Печать', 'Печать', 'Ext', 'ObjectModule.bsl')));
		assert.ok(!fs.existsSync(path.join(staging, 'Загрузка')));
	});
});
