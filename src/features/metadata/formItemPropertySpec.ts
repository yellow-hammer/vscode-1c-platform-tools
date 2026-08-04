/**
 * Спецификация свойств элементов формы: подпись и группа для узла XML.
 *
 * Состав свойств приходит от md-sparrow (он снимает его с модели формата), а как их назвать
 * и в какую группу положить - решает расширение: в самой модели этого нет.
 *
 * @module formItemPropertySpec
 */

/** Группы палитры в порядке показа; последняя собирает всё, чему группа не назначена. */
export const PROPERTY_GROUP_ORDER = [
	'Основные',
	'Использование',
	'Расположение',
	'Оформление',
	'Данные',
	'События',
	'Прочие',
] as const;

export type PropertyGroupName = (typeof PROPERTY_GROUP_ORDER)[number];

interface PropertySpec {
	readonly label: string;
	readonly group: PropertyGroupName;
}

/**
 * Подпись и группа для узла свойства. Русские названия те же, что в конфигураторе.
 * Чего здесь нет, палитра покажет под именем узла в группе «Прочие»: словарь свойств приходит
 * от модели формата и растёт вместе с платформой, поэтому список заведомо неполный и это нормально.
 */
const SPEC: Record<string, PropertySpec> = {
	name: { label: 'Имя', group: 'Основные' },
	id: { label: 'Идентификатор', group: 'Основные' },
	Title: { label: 'Заголовок', group: 'Основные' },
	TitleLocation: { label: 'Положение заголовка', group: 'Расположение' },
	TitleHeight: { label: 'Высота заголовка', group: 'Расположение' },
	TitleTextColor: { label: 'Цвет текста заголовка', group: 'Оформление' },
	TitleBackColor: { label: 'Цвет фона заголовка', group: 'Оформление' },
	TitleFont: { label: 'Шрифт заголовка', group: 'Оформление' },
	TitleDataPath: { label: 'Путь к данным заголовка', group: 'Данные' },
	ShowTitle: { label: 'Отображать заголовок', group: 'Основные' },
	DataPath: { label: 'Путь к данным', group: 'Данные' },
	Type: { label: 'Вид', group: 'Основные' },
	Kind: { label: 'Вид', group: 'Основные' },
	Visible: { label: 'Видимость', group: 'Использование' },
	UserVisible: { label: 'Пользовательская видимость', group: 'Использование' },
	Enabled: { label: 'Доступность', group: 'Использование' },
	ReadOnly: { label: 'Только просмотр', group: 'Использование' },
	SkipOnInput: { label: 'Пропускать при вводе', group: 'Использование' },
	DefaultItem: { label: 'Активизировать по умолчанию', group: 'Использование' },
	EnableContentChange: { label: 'Изменение состава', group: 'Использование' },
	DisplayImportance: { label: 'Важность при отображении', group: 'Использование' },
	ToolTip: { label: 'Подсказка', group: 'Основные' },
	ToolTipRepresentation: { label: 'Отображение подсказки', group: 'Оформление' },
	Width: { label: 'Ширина', group: 'Расположение' },
	Height: { label: 'Высота', group: 'Расположение' },
	AutoMaxWidth: { label: 'Автомаксимальная ширина', group: 'Расположение' },
	AutoMaxHeight: { label: 'Автомаксимальная высота', group: 'Расположение' },
	MaxWidth: { label: 'Максимальная ширина', group: 'Расположение' },
	MaxHeight: { label: 'Максимальная высота', group: 'Расположение' },
	HorizontalStretch: { label: 'Растягивать по горизонтали', group: 'Расположение' },
	VerticalStretch: { label: 'Растягивать по вертикали', group: 'Расположение' },
	HorizontalAlign: { label: 'Горизонтальное положение', group: 'Расположение' },
	VerticalAlign: { label: 'Вертикальное положение', group: 'Расположение' },
	GroupHorizontalAlign: { label: 'Горизонтальное положение в группе', group: 'Расположение' },
	GroupVerticalAlign: { label: 'Вертикальное положение в группе', group: 'Расположение' },
	Group: { label: 'Группировка', group: 'Расположение' },
	ChildrenAlign: { label: 'Выравнивание подчинённых', group: 'Расположение' },
	ChildItemsWidth: { label: 'Ширина подчинённых', group: 'Расположение' },
	ChildItemsTitleLocation: { label: 'Положение заголовков подчинённых', group: 'Расположение' },
	HorizontalSpacing: { label: 'Интервал по горизонтали', group: 'Расположение' },
	VerticalSpacing: { label: 'Интервал по вертикали', group: 'Расположение' },
	Representation: { label: 'Отображение', group: 'Оформление' },
	ControlRepresentation: { label: 'Отображение управления', group: 'Оформление' },
	Behavior: { label: 'Поведение', group: 'Использование' },
	Collapsed: { label: 'Свёрнута', group: 'Использование' },
	United: { label: 'Объединять', group: 'Оформление' },
	ShowLeftMargin: { label: 'Отображать левый отступ', group: 'Оформление' },
	BackColor: { label: 'Цвет фона', group: 'Оформление' },
	TextColor: { label: 'Цвет текста', group: 'Оформление' },
	BorderColor: { label: 'Цвет рамки', group: 'Оформление' },
	Border: { label: 'Рамка', group: 'Оформление' },
	Font: { label: 'Шрифт', group: 'Оформление' },
	Picture: { label: 'Картинка', group: 'Оформление' },
	Shortcut: { label: 'Сочетание клавиш', group: 'Использование' },
	CommandName: { label: 'Имя команды', group: 'Данные' },
	CommandSet: { label: 'Состав команд', group: 'Данные' },
	FunctionalOptions: { label: 'Функциональные опции', group: 'Использование' },
	EditMode: { label: 'Режим редактирования', group: 'Использование' },
	FixingInTable: { label: 'Фиксация в таблице', group: 'Расположение' },
	AutoCellHeight: { label: 'Автовысота ячейки', group: 'Расположение' },
	CellHyperlink: { label: 'Гиперссылка ячейки', group: 'Оформление' },
	ShowInHeader: { label: 'Отображать в шапке', group: 'Использование' },
	ShowInFooter: { label: 'Отображать в подвале', group: 'Использование' },
	FooterText: { label: 'Текст подвала', group: 'Данные' },
	FooterDataPath: { label: 'Путь к данным подвала', group: 'Данные' },
	MarkNegatives: { label: 'Выделять отрицательные', group: 'Оформление' },
	Format: { label: 'Формат', group: 'Оформление' },
	EditFormat: { label: 'Формат редактирования', group: 'Оформление' },
	Mask: { label: 'Маска', group: 'Использование' },
	PasswordMode: { label: 'Режим пароля', group: 'Использование' },
	MultiLine: { label: 'Многострочный режим', group: 'Использование' },
	ExtendedEdit: { label: 'Расширенное редактирование', group: 'Использование' },
	ChoiceList: { label: 'Список выбора', group: 'Данные' },
	ChoiceForm: { label: 'Форма выбора', group: 'Данные' },
	QuickChoice: { label: 'Быстрый выбор', group: 'Использование' },
	ChoiceFoldersAndItems: { label: 'Выбор групп и элементов', group: 'Использование' },
	ChoiceParameters: { label: 'Параметры выбора', group: 'Данные' },
	ChoiceParameterLinks: { label: 'Связи параметров выбора', group: 'Данные' },
	CreateButton: { label: 'Кнопка создания', group: 'Использование' },
	ClearButton: { label: 'Кнопка очистки', group: 'Использование' },
	ChoiceButton: { label: 'Кнопка выбора', group: 'Использование' },
	OpenButton: { label: 'Кнопка открытия', group: 'Использование' },
	SpinButton: { label: 'Кнопка регулирования', group: 'Использование' },
	TypeLink: { label: 'Связь по типу', group: 'Данные' },
	TypeRestriction: { label: 'Ограничение типа', group: 'Данные' },
	AutoMarkIncomplete: { label: 'Автоотметка незаполненного', group: 'Использование' },
	MarkIncomplete: { label: 'Отметка незаполненного', group: 'Использование' },
	WarningOnEdit: { label: 'Предупреждение при редактировании', group: 'Использование' },
	WarningOnEditRepresentation: { label: 'Отображение предупреждения', group: 'Использование' },
};

/** Подпись свойства: из спецификации, иначе имя узла как есть. */
export function propertyLabel(name: string): string {
	return SPEC[name]?.label ?? name;
}

/** Группа свойства: из спецификации, иначе «Прочие». */
export function propertyGroupName(name: string): PropertyGroupName {
	return SPEC[name]?.group ?? 'Прочие';
}
