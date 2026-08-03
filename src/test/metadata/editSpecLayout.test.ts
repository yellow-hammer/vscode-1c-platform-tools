import * as assert from 'node:assert';
import {
	buildBusinessProcessEditTabs,
	buildCatalogEditTabs,
	buildCommonAttributeEditTabs,
	buildCommonCommandEditTabs,
	buildCommonPictureEditTabs,
	buildExternalDataSourceEditTabs,
	buildRoleEditTabs,
	buildDocumentNumeratorEditTabs,
	buildEventSubscriptionEditTabs,
	buildScheduledJobEditTabs,
	buildSessionParameterEditTabs,
	buildChartOfAccountsEditTabs,
	buildChartOfCalculationTypesEditTabs,
	buildChartOfCharacteristicTypesEditTabs,
	buildCommonModuleEditTabs,
	buildConstantEditTabs,
	buildDocumentEditTabs,
	buildDocumentJournalEditTabs,
	buildEnumEditTabs,
	buildExchangePlanEditTabs,
	buildRegisterEditTabs,
	buildReportEditTabs,
	buildTaskEditTabs,
	KNOWN_GROUP_TITLES,
	normalizeTabLayout,
	type MetadataEditTabSpec,
} from '../../features/metadata/metadataObjectEditSpec';

const base = { internalName: 'Объект', formNames: ['ФормаОбъекта'], commandNames: ['Команда'] };

const byKind: ReadonlyArray<[string, MetadataEditTabSpec[]]> = [
	['справочник', buildCatalogEditTabs({ ...base })],
	['документ', buildDocumentEditTabs({ ...base })],
	['перечисление', buildEnumEditTabs({ ...base })],
	['константа', buildConstantEditTabs({ ...base })],
	['общий модуль', buildCommonModuleEditTabs()],
	['регистр сведений', buildRegisterEditTabs({ ...base, information: true })],
	['регистр накопления', buildRegisterEditTabs({ ...base, information: false })],
	['отчёт', buildReportEditTabs({ ...base, report: true })],
	['обработка', buildReportEditTabs({ ...base, report: false })],
	['журнал документов', buildDocumentJournalEditTabs({ ...base })],
	['план обмена', buildExchangePlanEditTabs({ ...base })],
	['план видов характеристик', buildChartOfCharacteristicTypesEditTabs({ ...base })],
	['задача', buildTaskEditTabs({ ...base })],
	['бизнес-процесс', buildBusinessProcessEditTabs({ ...base })],
	['план счетов', buildChartOfAccountsEditTabs({ ...base })],
	['план видов расчёта', buildChartOfCalculationTypesEditTabs({ ...base })],
];

function titles(tabs: readonly MetadataEditTabSpec[]): string[] {
	return tabs.map((tab) => tab.title);
}

function fieldLabels(tabs: readonly MetadataEditTabSpec[], tabTitle: string, groupTitle: string): string[] {
	const group = tabs
		.find((tab) => tab.title === tabTitle)
		?.groups.find((item) => item.title === groupTitle);
	assert.ok(group, `нет группы ${groupTitle} на вкладке ${tabTitle}`);
	return group.fields.map((field) => field.label);
}

suite('metadataObjectEditSpec: канон раскладки', () => {
	test('все группы построителей известны канону', () => {
		const unknown = new Set<string>();
		for (const [, tabs] of byKind) {
			for (const tab of tabs) {
				for (const group of tab.groups) {
					if (!KNOWN_GROUP_TITLES.includes(group.title)) {
						unknown.add(group.title);
					}
				}
			}
		}

		assert.deepStrictEqual([...unknown], [], 'группы вне канона попадут на «Основные»');
	});

	test('порядок вкладок у всех видов из канона', () => {
		const canonical = [
			'Основные',
			'Данные',
			'Адресация',
			'Компоновка',
			'Субконто',
			'Расчёт',
			'Движения',
			'Регистрируемые документы',
			'Обмен данными',
			'Формы',
			'Команды',
			'Ввод на основании',
		];

		for (const [kind, tabs] of byKind) {
			const actual = titles(normalizeTabLayout(tabs));
			const expected = canonical.filter((title) => actual.includes(title));
			assert.deepStrictEqual(actual, expected, `порядок вкладок: ${kind}`);
			assert.deepStrictEqual(actual, [...new Set(actual)], `вкладки не повторяются: ${kind}`);
		}
	});

	test('ссылки на модули у всех видов в одной группе на «Основных»', () => {
		for (const [kind, tabs] of byKind) {
			const normalized = normalizeTabLayout(tabs);
			const modules = normalized
				.flatMap((tab) => tab.groups.map((group) => ({ tab: tab.title, group })))
				.filter((item) => item.group.fields.some((field) => field.control === 'moduleLink'));

			for (const item of modules) {
				assert.strictEqual(item.group.title, 'Модули', `модули вида ${kind}`);
				assert.strictEqual(item.tab, 'Основные', `вкладка модулей вида ${kind}`);
			}
		}
	});

	test('свойства ввода и блокировки у всех видов в своих группах', () => {
		for (const [kind, tabs] of byKind) {
			for (const tab of normalizeTabLayout(tabs)) {
				for (const group of tab.groups) {
					for (const field of group.fields) {
						const property = field.path.slice(field.path.lastIndexOf('.') + 1);
						if (property === 'inputByString' || property === 'choiceHistoryOnInput') {
							assert.strictEqual(group.title, 'Поле ввода', `${kind}: ${property}`);
						}
						if (property === 'dataLockFields' || property === 'dataHistory') {
							assert.strictEqual(group.title, 'Блокировка и история', `${kind}: ${property}`);
						}
						if (property === 'basedOn') {
							assert.strictEqual(tab.title, 'Ввод на основании', `${kind}: ввод на основании`);
						}
					}
				}
			}
		}
	});

	test('задача: адресация своей вкладкой, а не посреди основных', () => {
		const tabs = normalizeTabLayout(buildTaskEditTabs({ ...base }));

		assert.deepStrictEqual(titles(tabs), ['Основные', 'Данные', 'Адресация', 'Формы', 'Команды', 'Ввод на основании']);
		assert.deepStrictEqual(fieldLabels(tabs, 'Адресация', 'Адресация'), [
			'Адресация',
			'Основной реквизит адресации',
			'Текущий исполнитель',
		]);
		assert.deepStrictEqual(fieldLabels(tabs, 'Основные', 'Основные'), ['Имя', 'Синоним', 'Комментарий']);
	});

	test('отчёт: схема компоновки и хранилища своей вкладкой', () => {
		const tabs = normalizeTabLayout(buildReportEditTabs({ ...base, report: true, templateNames: ['Схема'] }));

		assert.deepStrictEqual(titles(tabs), ['Основные', 'Компоновка', 'Формы', 'Команды']);
		assert.deepStrictEqual(fieldLabels(tabs, 'Компоновка', 'Компоновка'), [
			'Основная схема компоновки данных',
			'Хранилище вариантов',
			'Хранилище настроек',
		]);
	});

	test('пустые вкладки не показываются, незнакомая группа не теряется', () => {
		const normalized = normalizeTabLayout([
			{ id: 'edit_main', title: 'Основные', groups: [{ title: 'Основные', fields: [] }] },
			{
				id: 'edit_custom',
				title: 'Своё',
				groups: [{ title: 'Своя группа', fields: [{ path: 'x.y', label: 'Поле', control: 'text' }] }],
			},
		]);

		assert.deepStrictEqual(titles(normalized), ['Основные']);
		assert.deepStrictEqual(
			normalized[0].groups.map((group) => group.title),
			['Своя группа']
		);
	});
});

suite('metadataObjectEditSpec: общие свойства ссылочных видов', () => {
	const referenceKinds = byKind.filter(([kind]) =>
		[
			'справочник',
			'документ',
			'план обмена',
			'план видов характеристик',
			'задача',
			'бизнес-процесс',
			'план счетов',
			'план видов расчёта',
		].includes(kind)
	);

	test('поле ввода, история данных и вспомогательные формы есть у каждого', () => {
		for (const [kind, tabs] of referenceKinds) {
			const paths = new Set(
				normalizeTabLayout(tabs).flatMap((tab) => tab.groups.flatMap((group) => group.fields.map((f) => f.path)))
			);
			const block = [...paths].find((path) => path.endsWith('.dataHistory'))?.split('.')[0];
			assert.ok(block, `${kind}: нет блока свойств`);
			for (const property of [
				'createOnInput',
				'searchStringModeOnInputByString',
				'fullTextSearchOnInputByString',
				'choiceDataGetModeOnInputByString',
				'fullTextSearch',
				'dataHistory',
				'updateDataHistoryImmediatelyAfterWrite',
				'executeAfterWriteDataHistoryVersionProcessing',
				'basedOn',
				'auxiliaryListForm',
			]) {
				assert.ok(paths.has(`${block}.${property}`), `${kind}: нет свойства ${property}`);
			}
		}
	});

	test('свойство не задваивается, если вид объявил его сам', () => {
		for (const [kind, tabs] of referenceKinds) {
			const paths = normalizeTabLayout(tabs)
				.flatMap((tab) => tab.groups.flatMap((group) => group.fields.map((field) => field.path)))
				.filter((path) => path.length > 0);

			assert.deepStrictEqual(paths, [...new Set(paths)], `${kind}: свойство встречается дважды`);
		}
	});
});

suite('metadataObjectEditSpec: порядок свойств в группе', () => {
	test('поле ввода и блокировка идут одинаково у всех видов', () => {
		const order = (tabs: readonly MetadataEditTabSpec[], groupTitle: string): string[] =>
			normalizeTabLayout(tabs)
				.flatMap((tab) => tab.groups)
				.filter((group) => group.title === groupTitle)
				.flatMap((group) => group.fields.map((field) => field.path.slice(field.path.lastIndexOf('.') + 1)));

		for (const [kind, tabs] of byKind) {
			for (const groupTitle of ['Поле ввода', 'Блокировка и история', 'Основные формы', 'Вспомогательные формы']) {
				const canonical = CANONICAL_ORDER[groupTitle];
				// свойство вне канона идёт следом за каноническими, сохраняя порядок объявления
				const rank = (property: string): number => {
					const index = canonical.indexOf(property);
					return index === -1 ? canonical.length : index;
				};
				const actual = order(tabs, groupTitle);
				const sorted = actual
					.map((property, index) => ({ property, index }))
					.sort((a, b) => rank(a.property) - rank(b.property) || a.index - b.index)
					.map((item) => item.property);
				assert.deepStrictEqual(actual, sorted, `${kind}: порядок в группе «${groupTitle}»`);
			}
		}
	});
});

const CANONICAL_ORDER: Record<string, string[]> = {
	'Поле ввода': [
		'quickChoice',
		'choiceMode',
		'createOnInput',
		'inputByString',
		'searchStringModeOnInputByString',
		'fullTextSearchOnInputByString',
		'choiceDataGetModeOnInputByString',
		'choiceHistoryOnInput',
	],
	'Блокировка и история': [
		'dataLockFields',
		'dataLockControlMode',
		'fullTextSearch',
		'dataHistory',
		'updateDataHistoryImmediatelyAfterWrite',
		'executeAfterWriteDataHistoryVersionProcessing',
	],
	'Вспомогательные формы': [
		'auxiliaryObjectForm',
		'auxiliaryFolderForm',
		'auxiliaryListForm',
		'auxiliaryChoiceForm',
		'auxiliaryFolderChoiceForm',
		'auxiliaryRecordForm',
		'auxiliaryForm',
		'auxiliarySettingsForm',
		'auxiliaryVariantForm',
	],
	'Основные формы': [
		'defaultObjectForm',
		'defaultFolderForm',
		'defaultListForm',
		'defaultChoiceForm',
		'defaultFolderChoiceForm',
		'defaultRecordForm',
		'defaultForm',
		'defaultSettingsForm',
		'defaultVariantForm',
	],
};

suite('metadataObjectEditSpec: виды без состава', () => {
	const cases: ReadonlyArray<[string, MetadataEditTabSpec[], string]> = [
		['параметр сеанса', buildSessionParameterEditTabs(), 'sessionParameter.type'],
		['нумератор документов', buildDocumentNumeratorEditTabs(), 'documentNumerator.numberType'],
		['подписка на событие', buildEventSubscriptionEditTabs(), 'eventSubscription.handler'],
		['регламентное задание', buildScheduledJobEditTabs(), 'scheduledJob.schedule'],
		['общая команда', buildCommonCommandEditTabs(), 'commonCommand.parameterUseMode'],
		['общий реквизит', buildCommonAttributeEditTabs(), 'commonAttribute.dataSeparation'],
		['общая картинка', buildCommonPictureEditTabs(), 'commonPicture.availabilityForChoice'],
		['внешний источник данных', buildExternalDataSourceEditTabs(), 'externalDataSource.dataLockControlMode'],
	];

	test('раскладка по канону: имя, синоним и свойства вида', () => {
		for (const [kind, tabs, keyPath] of cases) {
			const normalized = normalizeTabLayout(tabs);
			const paths = normalized.flatMap((tab) => tab.groups.flatMap((group) => group.fields.map((f) => f.path)));

			assert.ok(paths.includes('internalName'), `${kind}: нет имени`);
			assert.ok(paths.includes('synonymRu'), `${kind}: нет синонима`);
			assert.ok(paths.includes(keyPath), `${kind}: нет свойства ${keyPath}`);
			assert.deepStrictEqual(paths, [...new Set(paths)], `${kind}: свойство встречается дважды`);
			for (const tab of normalized) {
				for (const group of tab.groups) {
					assert.ok(KNOWN_GROUP_TITLES.includes(group.title), `${kind}: группа вне канона - ${group.title}`);
				}
			}
		}
	});

	test('у роли правятся только общие поля: права живут отдельным файлом', () => {
		const paths = normalizeTabLayout(buildRoleEditTabs())
			.flatMap((tab) => tab.groups.flatMap((group) => group.fields.map((field) => field.path)));

		assert.deepStrictEqual(paths, ['internalName', 'synonymRu', 'comment']);
	});

	test('у общей команды модуль в группе модулей', () => {
		const tabs = normalizeTabLayout(buildCommonCommandEditTabs());
		const modules = tabs
			.flatMap((tab) => tab.groups)
			.find((group) => group.title === 'Модули');

		assert.deepStrictEqual(modules?.fields.map((field) => field.label), ['Модуль команды']);
	});
});
