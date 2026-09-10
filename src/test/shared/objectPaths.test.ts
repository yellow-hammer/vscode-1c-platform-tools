import * as assert from 'node:assert';
import * as fs from 'node:fs';
import * as path from 'node:path';
import {
	commandModuleFileOf,
	configurationDescriptorFile,
	configurationModuleFile,
	formContentFileOf,
	formDescriptorFileOf,
	nestedSubsystemFileOf,
	nestedSubsystemsDirectoryOf,
	templateContentFileOf,
	templateDescriptorFileOf,
	formModuleFile,
	formModuleFileOf,
	formModuleNextTo,
	formOwnerFileOf,
	formatOfFile,
	helpDirectoryOf,
	moduleFile,
	moduleFileOf,
	objectDirectory,
	objectDirectoryOf,
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

suite('пути по файлу описания объекта', () => {
	const designerObject = path.join('C:', 'п', 'src', 'cf', 'Catalogs', 'Валюты.xml');
	const edtObject = path.join('C:', 'п', 'ssl31', 'src', 'Catalogs', 'Валюты', 'Валюты.mdo');

	test('формат виден по расширению файла', () => {
		assert.strictEqual(formatOfFile(designerObject), 'designer');
		assert.strictEqual(formatOfFile(edtObject), 'edt');
		assert.strictEqual(formatOfFile(path.join('C:', 'п', 'Forms', 'Форма', 'Form.form')), 'edt');
	});

	test('каталог объекта: рядом с описанием у конфигуратора, вокруг него у EDT', () => {
		assert.strictEqual(objectDirectoryOf(designerObject), path.join('C:', 'п', 'src', 'cf', 'Catalogs', 'Валюты'));
		assert.strictEqual(objectDirectoryOf(edtObject), path.join('C:', 'п', 'ssl31', 'src', 'Catalogs', 'Валюты'));
		// Каталог назван по файлу: у внешней обработки объект внутри может зваться иначе
		const external = path.join('C:', 'п', 'tests', 'epf', 'Тест.xml');
		assert.strictEqual(objectDirectoryOf(external), path.join('C:', 'п', 'tests', 'epf', 'Тест'));
	});

	test('модули объекта, формы и команды по раскладке формата', () => {
		assert.strictEqual(
			moduleFileOf(designerObject, 'object'),
			path.join('C:', 'п', 'src', 'cf', 'Catalogs', 'Валюты', 'Ext', 'ObjectModule.bsl')
		);
		assert.strictEqual(
			moduleFileOf(edtObject, 'valueManager'),
			path.join('C:', 'п', 'ssl31', 'src', 'Catalogs', 'Валюты', 'ValueManagerModule.bsl')
		);
		assert.strictEqual(
			formModuleFileOf(designerObject, 'ФормаСписка'),
			path.join('C:', 'п', 'src', 'cf', 'Catalogs', 'Валюты', 'Forms', 'ФормаСписка', 'Ext', 'Form', 'Module.bsl')
		);
		assert.strictEqual(
			formModuleFileOf(edtObject, 'ФормаСписка'),
			path.join('C:', 'п', 'ssl31', 'src', 'Catalogs', 'Валюты', 'Forms', 'ФормаСписка', 'Module.bsl')
		);
		assert.strictEqual(
			commandModuleFileOf(edtObject, 'Открыть'),
			path.join('C:', 'п', 'ssl31', 'src', 'Catalogs', 'Валюты', 'Commands', 'Открыть', 'CommandModule.bsl')
		);
		assert.strictEqual(
			commandModuleFileOf(designerObject, 'Открыть'),
			path.join('C:', 'п', 'src', 'cf', 'Catalogs', 'Валюты', 'Commands', 'Открыть', 'Ext', 'CommandModule.bsl')
		);
	});

	test('общая форма сама является формой', () => {
		const designerForm = path.join('C:', 'п', 'src', 'cf', 'CommonForms', 'Настройки.xml');
		const edtForm = path.join('C:', 'п', 'ssl31', 'src', 'CommonForms', 'Настройки', 'Настройки.mdo');
		assert.strictEqual(
			formContentFileOf(designerForm),
			path.join('C:', 'п', 'src', 'cf', 'CommonForms', 'Настройки', 'Ext', 'Form.xml')
		);
		assert.strictEqual(formContentFileOf(edtForm), path.join('C:', 'п', 'ssl31', 'src', 'CommonForms', 'Настройки', 'Form.form'));
		assert.strictEqual(
			formModuleFileOf(designerForm),
			path.join('C:', 'п', 'src', 'cf', 'CommonForms', 'Настройки', 'Ext', 'Form', 'Module.bsl')
		);
		assert.strictEqual(formModuleFileOf(edtForm), path.join('C:', 'п', 'ssl31', 'src', 'CommonForms', 'Настройки', 'Module.bsl'));
	});

	test('содержимое формы и модуль рядом с ним', () => {
		const designerContent = formContentFileOf(designerObject, 'ФормаСписка');
		const edtContent = formContentFileOf(edtObject, 'ФормаСписка');
		assert.strictEqual(
			designerContent,
			path.join('C:', 'п', 'src', 'cf', 'Catalogs', 'Валюты', 'Forms', 'ФормаСписка', 'Ext', 'Form.xml')
		);
		assert.strictEqual(edtContent, path.join('C:', 'п', 'ssl31', 'src', 'Catalogs', 'Валюты', 'Forms', 'ФормаСписка', 'Form.form'));
		assert.strictEqual(formModuleNextTo(designerContent), path.join(path.dirname(designerContent), 'Form', 'Module.bsl'));
		assert.strictEqual(formModuleNextTo(edtContent), path.join(path.dirname(edtContent), 'Module.bsl'));
	});

	test('владелец находится по содержимому формы, у общей формы владельца нет', () => {
		assert.strictEqual(formOwnerFileOf(formContentFileOf(designerObject, 'ФормаСписка')), designerObject);
		assert.strictEqual(formOwnerFileOf(formContentFileOf(edtObject, 'ФормаСписка')), edtObject);
		assert.strictEqual(formOwnerFileOf(path.join('C:', 'п', 'src', 'cf', 'CommonForms', 'Форма', 'Ext', 'Form.xml')), undefined);
		assert.strictEqual(formOwnerFileOf(path.join('C:', 'п', 'ssl31', 'src', 'CommonForms', 'Форма', 'Form.form')), undefined);
	});

	test('свойства формы и макета: свой файл у конфигуратора, у EDT их нет', () => {
		assert.strictEqual(
			formDescriptorFileOf(designerObject, 'ФормаСписка'),
			path.join('C:', 'п', 'src', 'cf', 'Catalogs', 'Валюты', 'Forms', 'ФормаСписка.xml')
		);
		assert.strictEqual(formDescriptorFileOf(edtObject, 'ФормаСписка'), undefined);
		assert.strictEqual(
			templateDescriptorFileOf(designerObject, 'Печать'),
			path.join('C:', 'п', 'src', 'cf', 'Catalogs', 'Валюты', 'Templates', 'Печать.xml')
		);
		assert.strictEqual(templateDescriptorFileOf(edtObject, 'Печать'), undefined);
	});

	test('содержимое макета объекта и общего макета', () => {
		assert.strictEqual(
			templateContentFileOf(designerObject, 'Печать'),
			path.join('C:', 'п', 'src', 'cf', 'Catalogs', 'Валюты', 'Templates', 'Печать', 'Ext', 'Template.xml')
		);
		assert.strictEqual(
			templateContentFileOf(edtObject, 'Печать'),
			path.join('C:', 'п', 'ssl31', 'src', 'Catalogs', 'Валюты', 'Templates', 'Печать', 'Template.dcs')
		);
		const designerCommon = path.join('C:', 'п', 'src', 'cf', 'CommonTemplates', 'Макет.xml');
		const edtCommon = path.join('C:', 'п', 'ssl31', 'src', 'CommonTemplates', 'Макет', 'Макет.mdo');
		assert.strictEqual(
			templateContentFileOf(designerCommon),
			path.join('C:', 'п', 'src', 'cf', 'CommonTemplates', 'Макет', 'Ext', 'Template.xml')
		);
		assert.strictEqual(templateContentFileOf(edtCommon), path.join('C:', 'п', 'ssl31', 'src', 'CommonTemplates', 'Макет', 'Template.dcs'));
	});

	test('вложенные подсистемы: файлом у конфигуратора, каталогом у EDT', () => {
		const designerSubsystem = path.join('C:', 'п', 'src', 'cf', 'Subsystems', 'Анкеты.xml');
		const edtSubsystem = path.join('C:', 'п', 'ssl31', 'src', 'Subsystems', 'Анкеты', 'Анкеты.mdo');
		assert.strictEqual(
			nestedSubsystemsDirectoryOf(designerSubsystem),
			path.join('C:', 'п', 'src', 'cf', 'Subsystems', 'Анкеты', 'Subsystems')
		);
		assert.strictEqual(
			nestedSubsystemsDirectoryOf(edtSubsystem),
			path.join('C:', 'п', 'ssl31', 'src', 'Subsystems', 'Анкеты', 'Subsystems')
		);
		assert.strictEqual(
			nestedSubsystemFileOf(designerSubsystem, 'Респонденты'),
			path.join('C:', 'п', 'src', 'cf', 'Subsystems', 'Анкеты', 'Subsystems', 'Респонденты.xml')
		);
		assert.strictEqual(
			nestedSubsystemFileOf(edtSubsystem, 'Респонденты'),
			path.join('C:', 'п', 'ssl31', 'src', 'Subsystems', 'Анкеты', 'Subsystems', 'Респонденты', 'Респонденты.mdo')
		);
	});

	test('описание конфигурации у каждого формата своё', () => {
		assert.strictEqual(configurationDescriptorFile(DESIGNER), path.join(DESIGNER.dir, 'Configuration.xml'));
		assert.strictEqual(configurationDescriptorFile(EDT), path.join(EDT.dir, 'src', 'Configuration', 'Configuration.mdo'));
		assert.ok(fs.existsSync(configurationDescriptorFile(EDT)), 'описание проекта EDT в фикстуре');
	});

	test('справка объекта и модули конфигурации', () => {
		assert.strictEqual(helpDirectoryOf(designerObject), path.join('C:', 'п', 'src', 'cf', 'Catalogs', 'Валюты', 'Ext', 'Help'));
		assert.strictEqual(helpDirectoryOf(edtObject), path.join('C:', 'п', 'ssl31', 'src', 'Catalogs', 'Валюты', 'Help'));
		assert.strictEqual(
			configurationModuleFile(path.join('C:', 'п', 'src', 'cf'), 'designer', 'SessionModule.bsl'),
			path.join('C:', 'п', 'src', 'cf', 'Ext', 'SessionModule.bsl')
		);
		assert.strictEqual(
			configurationModuleFile(path.join('C:', 'п', 'ssl31', 'src'), 'edt', 'SessionModule.bsl'),
			path.join('C:', 'п', 'ssl31', 'src', 'Configuration', 'SessionModule.bsl')
		);
	});

	test('пути по файлу ведут к настоящим файлам обеих раскладок', () => {
		const edtMdo = sourcePath(EDT, objectFile('edt', 'Справочник', 'Валюты') as string);
		const designerXml = sourcePath(DESIGNER, objectFile('designer', 'ОбщийМодуль', 'ОбщийТест') as string);
		const edtFormModule = formModuleFileOf(edtMdo, 'ФормаСписка');
		const designerModule = moduleFileOf(designerXml, 'module');

		assert.ok(fs.existsSync(edtFormModule), `нет файла ${edtFormModule}`);
		assert.ok(fs.existsSync(designerModule), `нет файла ${designerModule}`);
	});
});
