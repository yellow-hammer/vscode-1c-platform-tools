import * as assert from 'node:assert';
import { resolveBslPathFromMetadata } from '../../features/diagnostics/metadataPathResolver';

suite('metadataPathResolver', () => {
	test('общий модуль → CommonModules/.../Ext/Module.bsl', () => {
		assert.strictEqual(
			resolveBslPathFromMetadata('ОбщийМодуль.РаботаСФайлами.Модуль'),
			'CommonModules/РаботаСФайлами/Ext/Module.bsl'
		);
	});

	test('HTTP-сервис → HTTPServices/.../Ext/Module.bsl', () => {
		assert.strictEqual(
			resolveBslPathFromMetadata('HTTPСервис.Биллинг.Модуль'),
			'HTTPServices/Биллинг/Ext/Module.bsl'
		);
	});

	test('общая форма → CommonForms/.../Ext/Form/Module.bsl', () => {
		assert.strictEqual(
			resolveBslPathFromMetadata('ОбщаяФорма.ВыборПутиКАрхивуФайловТомов.Форма'),
			'CommonForms/ВыборПутиКАрхивуФайловТомов/Ext/Form/Module.bsl'
		);
	});

	test('подчинённая форма справочника → Forms/.../Ext/Form/Module.bsl', () => {
		assert.strictEqual(
			resolveBslPathFromMetadata('Справочник.Файлы.Форма.ФормаЭлемента.Форма'),
			'Catalogs/Файлы/Forms/ФормаЭлемента/Ext/Form/Module.bsl'
		);
	});

	test('подчинённая форма обработки → DataProcessors/.../Forms/...', () => {
		assert.strictEqual(
			resolveBslPathFromMetadata('Обработка.Сканирование.Форма.НастройкаСканирования.Форма'),
			'DataProcessors/Сканирование/Forms/НастройкаСканирования/Ext/Form/Module.bsl'
		);
	});

	test('модуль менеджера и модуль объекта', () => {
		assert.strictEqual(
			resolveBslPathFromMetadata('Справочник.Файлы.МодульМенеджера'),
			'Catalogs/Файлы/Ext/ManagerModule.bsl'
		);
		assert.strictEqual(
			resolveBslPathFromMetadata('Документ.ЗаказПокупателя.МодульОбъекта'),
			'Documents/ЗаказПокупателя/Ext/ObjectModule.bsl'
		);
	});

	test('справка и неизвестные типы не раскладываются в .bsl', () => {
		assert.strictEqual(
			resolveBslPathFromMetadata('ОбщаяФорма._ДемоМоиНастройки.Справка'),
			undefined
		);
		assert.strictEqual(resolveBslPathFromMetadata('НеизвестныйТип.Имя.Модуль'), undefined);
		assert.strictEqual(resolveBslPathFromMetadata('Справочник'), undefined);
		// У справочника нет одиночного Ext/Module.bsl
		assert.strictEqual(resolveBslPathFromMetadata('Справочник.Файлы.Модуль'), undefined);
	});
});
