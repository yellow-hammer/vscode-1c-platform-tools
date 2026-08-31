import * as assert from 'node:assert';
import * as fs from 'node:fs';
import * as path from 'node:path';
import {
	formModuleFile,
	moduleFile,
	objectDirectory,
	objectFile,
	sourceDirectory,
	sourcePath,
	typeDirectory,
} from '../../shared/objectPaths';
import type { SourceRoot } from '../../shared/projectLayout';

const FIXTURES = path.resolve(__dirname, '../../../src/test/fixtures/projectLayout');

/** Конфигурация в формате EDT. */
const EDT: SourceRoot = {
	dir: path.join(FIXTURES, 'edt-workspace', 'ssl31'),
	format: 'edt',
	name: 'БиблиотекаСтандартныхПодсистемДемо',
	isExtension: false,
};

/** Конфигурация в формате конфигуратора. */
const DESIGNER: SourceRoot = {
	dir: path.join(FIXTURES, 'designer', 'src', 'cf'),
	format: 'designer',
	name: 'Конфигурация',
	isExtension: false,
};

suite('пути объектов метаданных', () => {
	test('тип метаданных раскладывается в каталог', () => {
		assert.strictEqual(typeDirectory('Справочник'), 'Catalogs');
		assert.strictEqual(typeDirectory('ОбщийМодуль'), 'CommonModules');
		assert.strictEqual(typeDirectory('НетТакогоТипа'), undefined);
		assert.strictEqual(objectDirectory('Справочник', 'Валюты'), 'Catalogs/Валюты');
	});

	test('описание объекта: рядом с каталогом в конфигураторе, внутри в EDT', () => {
		assert.strictEqual(objectFile('designer', 'Справочник', 'Валюты'), 'Catalogs/Валюты.xml');
		assert.strictEqual(objectFile('edt', 'Справочник', 'Валюты'), 'Catalogs/Валюты/Валюты.mdo');
	});

	test('модуль объекта в EDT лежит без каталога Ext', () => {
		assert.strictEqual(
			moduleFile('designer', 'Справочник', 'Валюты', 'object'),
			'Catalogs/Валюты/Ext/ObjectModule.bsl'
		);
		assert.strictEqual(moduleFile('edt', 'Справочник', 'Валюты', 'object'), 'Catalogs/Валюты/ObjectModule.bsl');
		assert.strictEqual(
			moduleFile('designer', 'ОбщаяКоманда', 'Команда', 'command'),
			'CommonCommands/Команда/Ext/CommandModule.bsl'
		);
	});

	test('модуль формы: подчинённая и общая', () => {
		assert.strictEqual(
			formModuleFile('designer', 'Справочник', 'Валюты', 'ФормаСписка'),
			'Catalogs/Валюты/Forms/ФормаСписка/Ext/Form/Module.bsl'
		);
		assert.strictEqual(
			formModuleFile('edt', 'Справочник', 'Валюты', 'ФормаСписка'),
			'Catalogs/Валюты/Forms/ФормаСписка/Module.bsl'
		);
		assert.strictEqual(formModuleFile('edt', 'ОбщаяФорма', 'ФормаНастроек'), 'CommonForms/ФормаНастроек/Module.bsl');
	});

	test('в EDT исходники лежат в подкаталоге src', () => {
		assert.strictEqual(sourceDirectory(EDT), path.join(EDT.dir, 'src'));
		assert.strictEqual(sourceDirectory(DESIGNER), DESIGNER.dir);
	});

	test('построенные пути ведут к настоящим файлам обеих раскладок', () => {
		const edtObject = sourcePath(EDT, objectFile('edt', 'Справочник', 'Валюты') as string);
		const designerObject = sourcePath(DESIGNER, objectFile('designer', 'Справочник', 'Валюты') as string);
		const edtModule = sourcePath(EDT, moduleFile('edt', 'ОбщийМодуль', 'ОбщийТест', 'module') as string);
		const edtForm = sourcePath(EDT, formModuleFile('edt', 'Справочник', 'Валюты', 'ФормаСписка') as string);
		const designerModule = sourcePath(
			DESIGNER,
			moduleFile('designer', 'ОбщийМодуль', 'ОбщийТест', 'module') as string
		);

		assert.ok(fs.existsSync(edtObject), `нет файла ${edtObject}`);
		assert.ok(fs.existsSync(designerObject), `нет файла ${designerObject}`);
		assert.ok(fs.existsSync(edtModule), `нет файла ${edtModule}`);
		assert.ok(fs.existsSync(edtForm), `нет файла ${edtForm}`);
		assert.ok(fs.existsSync(designerModule), `нет файла ${designerModule}`);
	});
});
