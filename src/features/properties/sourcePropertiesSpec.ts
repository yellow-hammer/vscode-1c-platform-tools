/**
 * Спецификация свойств конфигурации, расширения и внешнего отчёта/обработки.
 *
 * У объектов метаданных спека уже описана вкладками (`metadataObjectEditSpec`), а у этих источников
 * панель-вкладка нарисована разметкой. Палитре нужна та же форма описания, поэтому набор полей
 * вынесен сюда - подписи те же, что в панели.
 *
 * @module sourcePropertiesSpec
 */

import type { MetadataEditOption, MetadataEditTabSpec } from '../metadata/metadataObjectEditSpec';

function opts(...values: readonly string[]): MetadataEditOption[] {
	return values.map((value) => ({ value, label: value }));
}

/** Режимы совместимости платформы; порядок как в конфигураторе - от новых к старым. */
const COMPATIBILITY_MODES = [
	'DONT_USE', 'VERSION_8_3_27', 'VERSION_8_3_26', 'VERSION_8_3_25', 'VERSION_8_3_24',
	'VERSION_8_3_23', 'VERSION_8_3_22', 'VERSION_8_3_21', 'VERSION_8_3_20', 'VERSION_8_3_19',
	'VERSION_8_3_18', 'VERSION_8_3_17', 'VERSION_8_3_16', 'VERSION_8_3_15', 'VERSION_8_3_14',
	'VERSION_8_3_13', 'VERSION_8_3_12', 'VERSION_8_3_11', 'VERSION_8_3_10', 'VERSION_8_3_9',
	'VERSION_8_3_8', 'VERSION_8_3_7', 'VERSION_8_3_6', 'VERSION_8_3_5', 'VERSION_8_3_4',
	'VERSION_8_3_3', 'VERSION_8_3_2', 'VERSION_8_3_1', 'VERSION_8_2_16', 'VERSION_8_2_13', 'VERSION_8_1',
];

/**
 * Свойства конфигурации и расширения.
 *
 * Модули и списки ролей палитра показывает текстом: ссылку на модуль и подбор ролей рисует
 * панель-вкладка, там для них есть место.
 */
export const SOURCE_PROPERTIES_TABS: readonly MetadataEditTabSpec[] = [
	{
		id: 'source_main',
		title: 'Свойства',
		groups: [
			{
				title: 'Основные',
				fields: [
					{ path: 'name', label: 'Имя', control: 'text' },
					{ path: 'synonymRu', label: 'Синоним', control: 'text' },
					{ path: 'comment', label: 'Комментарий', control: 'text' },
					{ path: 'defaultRunMode', label: 'Основной режим запуска', control: 'select', options: opts('MANAGED_APPLICATION', 'ORDINARY_APPLICATION') },
					{ path: 'scriptVariant', label: 'Вариант встроенного языка', control: 'select', options: opts('RUSSIAN', 'ENGLISH') },
					{ path: 'usePurposes', label: 'Назначение использования', control: 'staticList' },
					{ path: 'defaultRoles', label: 'Основные роли', control: 'staticList' },
				],
			},
			{
				title: 'Представление',
				fields: [
					{ path: 'briefInformationRu', label: 'Краткая информация', control: 'textarea' },
					{ path: 'detailedInformationRu', label: 'Подробная информация', control: 'textarea' },
					{ path: 'copyrightRu', label: 'Авторские права', control: 'textarea' },
					{ path: 'vendorInformationAddressRu', label: 'Адрес информации о поставщике', control: 'text' },
					{ path: 'configurationInformationAddressRu', label: 'Адрес информации о конфигурации', control: 'text' },
				],
			},
			{
				title: 'Разработка',
				fields: [
					{ path: 'vendor', label: 'Поставщик', control: 'text' },
					{ path: 'version', label: 'Версия', control: 'text' },
					{ path: 'updateCatalogAddress', label: 'Адрес каталога обновлений', control: 'text' },
				],
			},
			{
				title: 'Совместимость',
				fields: [
					{ path: 'dataLockControlMode', label: 'Режим управления блокировкой данных', control: 'select', options: opts('AUTOMATIC', 'MANAGED', 'AUTOMATIC_AND_MANAGED') },
					{ path: 'objectAutonumerationMode', label: 'Режим автонумерации объектов', control: 'select', options: opts('AUTO_FREE', 'NOT_AUTO_FREE') },
					{ path: 'modalityUseMode', label: 'Режим использования модальности', control: 'select', options: opts('USE', 'USE_WITH_WARNINGS', 'DONT_USE') },
					{
						path: 'synchronousPlatformExtensionAndAddInCallUseMode',
						label: 'Режим использования синхронных вызовов расширений',
						control: 'select',
						options: opts('USE', 'USE_WITH_WARNINGS', 'DONT_USE'),
					},
					{ path: 'interfaceCompatibilityMode', label: 'Режим совместимости интерфейса', control: 'select', options: opts('TAXI', 'TAXI_ENABLE_VERSION_8_2', 'VERSION_8_2_ENABLE_TAXI', 'VERSION_8_2') },
					{ path: 'compatibilityMode', label: 'Режим совместимости', control: 'select', options: opts(...COMPATIBILITY_MODES) },
				],
			},
			{
				title: 'Модули',
				fields: [
					{ path: 'managedApplicationModule', label: 'Модуль управляемого приложения', control: 'moduleLink' },
					{ path: 'sessionModule', label: 'Модуль сеанса', control: 'moduleLink' },
					{ path: 'externalConnectionModule', label: 'Модуль внешнего соединения', control: 'moduleLink' },
				],
			},
		],
	},
];

/** Свойства внешнего отчёта и внешней обработки: вид объекта задаётся при создании и не правится. */
export const EXTERNAL_ARTIFACT_TABS: readonly MetadataEditTabSpec[] = [
	{
		id: 'external_main',
		title: 'Свойства',
		groups: [
			{
				title: 'Основные',
				fields: [
					{ path: 'name', label: 'Имя', control: 'text' },
					{ path: 'synonymRu', label: 'Синоним', control: 'text' },
					{ path: 'comment', label: 'Комментарий', control: 'text' },
					{ path: 'kind', label: 'Вид', control: 'text', readonly: true },
				],
			},
		],
	},
];
