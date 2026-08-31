/**
 * Спецификация свойств конфигурации, расширения и внешнего отчёта/обработки.
 *
 * У объектов метаданных спека уже описана вкладками (`metadataObjectEditSpec`), а у этих источников
 * панель-вкладка нарисована разметкой. Палитре нужна та же форма описания, поэтому набор полей
 * вынесен сюда - подписи те же, что в панели.
 *
 * Варианты выпадающих списков спека не перечисляет: их вместе с подписями отдаёт md-sparrow, а свой
 * список разошёлся бы с форматом.
 *
 * @module sourcePropertiesSpec
 */

import type { MetadataEditTabSpec } from '../metadata/metadataObjectEditSpec';

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
					{ path: 'defaultRunMode', label: 'Основной режим запуска', control: 'select' },
					{ path: 'scriptVariant', label: 'Вариант встроенного языка', control: 'select' },
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
					{ path: 'dataLockControlMode', label: 'Режим управления блокировкой данных', control: 'select' },
					{ path: 'objectAutonumerationMode', label: 'Режим автонумерации объектов', control: 'select' },
					{ path: 'modalityUseMode', label: 'Режим использования модальности', control: 'select' },
					{
						path: 'synchronousPlatformExtensionAndAddInCallUseMode',
						label: 'Режим использования синхронных вызовов расширений',
						control: 'select',
					},
					{ path: 'interfaceCompatibilityMode', label: 'Режим совместимости интерфейса', control: 'select' },
					{ path: 'compatibilityMode', label: 'Режим совместимости', control: 'select' },
					{
						path: 'configurationExtensionCompatibilityMode',
						label: 'Режим совместимости расширения',
						control: 'select',
					},
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

