import * as assert from 'node:assert';
import {
	applyEnumDictionary,
	buildReportEditTabs,
	buildTaskEditTabs,
	ensureCurrentSelectValues,
	findUnknownEnumValues,
	type MetadataEditTabSpec,
} from '../../features/metadata/metadataObjectEditSpec';

const tabs: MetadataEditTabSpec[] = [
	{
		id: 'edit_main',
		title: 'Основные',
		groups: [
			{
				title: 'Основные',
				fields: [
					{
						path: 'chartOfCharacteristicTypes.codeSeries',
						label: 'Серия кодов',
						control: 'select',
						options: [
							{ value: 'WHOLE_CHARACTERISTIC_KIND', label: 'Во всём плане видов характеристик' },
							{ value: 'WHOLE_CHART_OF_CHARACTERISTIC_TYPES', label: 'Опечатка' },
						],
					},
					{
						path: 'chartOfCharacteristicTypes.defaultObjectForm',
						label: 'Основная форма объекта',
						control: 'select',
						options: [{ value: '', label: '(не задана)' }, { value: 'Форма', label: 'Форма' }],
						clearable: true,
					},
					{ path: 'synonymRu', label: 'Синоним', control: 'text' },
				],
			},
		],
	},
];

const dictionary = {
	'chartOfCharacteristicTypes.codeSeries': ['WHOLE_CHARACTERISTIC_KIND', 'WITHIN_SUBORDINATION'],
};

suite('metadataObjectEditSpec: словарь значений формата', () => {
	test('значения не из формата в список не попадают', () => {
		const applied = applyEnumDictionary(tabs, dictionary);

		const field = applied[0].groups[0].fields[0];
		assert.deepStrictEqual(
			field.options?.map((option) => option.value),
			['WHOLE_CHARACTERISTIC_KIND', 'WITHIN_SUBORDINATION']
		);
		assert.strictEqual(field.options?.[0].label, 'Во всём плане видов характеристик');
	});

	test('значение формата без подписи показывается константой', () => {
		const applied = applyEnumDictionary(tabs, dictionary);

		assert.strictEqual(applied[0].groups[0].fields[0].options?.[1].label, 'WITHIN_SUBORDINATION');
	});

	test('свойства вне словаря остаются как в спеке', () => {
		const applied = applyEnumDictionary(tabs, dictionary);

		const форма = applied[0].groups[0].fields[1];
		assert.deepStrictEqual(
			форма.options?.map((option) => option.value),
			['', 'Форма']
		);
		assert.strictEqual(форма.clearable, true);
		assert.strictEqual(applied[0].groups[0].fields[2].control, 'text');
	});

	test('пустой словарь ничего не меняет', () => {
		assert.deepStrictEqual(applyEnumDictionary(tabs, {}), tabs);
	});

	test('расхождения спеки с форматом перечислимы для лога', () => {
		assert.deepStrictEqual(findUnknownEnumValues(tabs, dictionary), [
			'chartOfCharacteristicTypes.codeSeries: WHOLE_CHART_OF_CHARACTERISTIC_TYPES',
		]);
		assert.deepStrictEqual(findUnknownEnumValues(tabs, {}), []);
	});
});

suite('metadataObjectEditSpec: значение из файла и общие формы', () => {
	const reportTabs = buildReportEditTabs({
		internalName: 'ДинамикаФайлов',
		formNames: ['ФормаОтчёта'],
		commandNames: [],
		commonFormNames: ['ФормаОтчета'],
		report: true,
	});

	function options(tabs: readonly MetadataEditTabSpec[], path: string): Array<{ value: string; label: string }> {
		for (const tab of tabs) {
			for (const group of tab.groups) {
				for (const field of group.fields) {
					if (field.path === path) {
						return (field.options ?? []).map((option) => ({ value: option.value, label: option.label }));
					}
				}
			}
		}
		throw new Error(`нет поля ${path}`);
	}

	test('общие формы конфигурации идут кандидатами в основную форму', () => {
		const values = options(reportTabs, 'report.defaultForm').map((option) => option.value);

		assert.ok(values.includes('Report.ДинамикаФайлов.Form.ФормаОтчёта'));
		assert.ok(values.includes('CommonForm.ФормаОтчета'));
	});

	test('значение из файла попадает в список, даже если его нет среди кандидатов', () => {
		const applied = ensureCurrentSelectValues(reportTabs, {
			report: { defaultForm: 'CommonForm.ФормаОтчетаДругойПодсистемы' },
		});

		const форма = options(applied, 'report.defaultForm').at(-1);
		assert.deepStrictEqual(форма, {
			value: 'CommonForm.ФормаОтчетаДругойПодсистемы',
			label: 'ФормаОтчетаДругойПодсистемы',
		});
	});

	test('известное значение не задваивается', () => {
		const applied = ensureCurrentSelectValues(reportTabs, {
			report: { defaultForm: 'CommonForm.ФормаОтчета' },
		});

		assert.deepStrictEqual(options(applied, 'report.defaultForm'), options(reportTabs, 'report.defaultForm'));
	});

	test('пустое значение списка не меняет', () => {
		const tabs = buildTaskEditTabs({
			internalName: 'ЗадачаИсполнителя',
			formNames: [],
			commandNames: [],
			sessionParameterNames: ['ТекущийПользователь'],
		});

		assert.deepStrictEqual(ensureCurrentSelectValues(tabs, { task: { currentPerformer: '' } }), tabs);
	});
});

suite('metadataObjectEditSpec: поля блокировки данных', () => {
	test('кандидаты берутся из стандартных реквизитов объекта', () => {
		const tabs = buildTaskEditTabs({
			internalName: 'ЗадачаИсполнителя',
			formNames: [],
			commandNames: [],
			standardAttributeNames: ['Number', 'Date', 'BusinessProcess', 'Исполнено'],
			attributeNames: ['Важность'],
		});

		const lock = tabs
			.flatMap((tab) => tab.groups.flatMap((group) => group.fields))
			.find((field) => field.path === 'task.dataLockFields');

		assert.deepStrictEqual(
			lock?.options?.map((option) => `${option.value} — ${option.label}`),
			[
				'Task.ЗадачаИсполнителя.StandardAttribute.Number — Номер',
				'Task.ЗадачаИсполнителя.StandardAttribute.Date — Дата',
				'Task.ЗадачаИсполнителя.StandardAttribute.BusinessProcess — Бизнес-процесс',
				'Task.ЗадачаИсполнителя.StandardAttribute.Исполнено — Исполнено',
				'Task.ЗадачаИсполнителя.Attribute.Важность — Важность',
			]
		);
	});
});
