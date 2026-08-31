(function () {
	const vscode = acquireVsCodeApi();
	let model = window.__INITIAL_DATA__ || {};
	const tabsRoot = document.getElementById('tabs');
	const contentRoot = document.getElementById('content');
	const statusEl = document.getElementById('status');
	let saving = false;

	/** Вкладки схемы в порядке конфигуратора; пустые не показываются. */
	const TABS = [
		{ id: 'dataSets', title: 'Наборы данных', count: () => list('dataSets').length, render: renderDataSets },
		{ id: 'links', title: 'Связи наборов', count: () => list('dataSetLinks').length, render: renderLinks },
		{
			id: 'calculated',
			title: 'Вычисляемые поля',
			count: () => list('calculatedFields').length,
			render: renderCalculated,
			always: true,
		},
		{ id: 'resources', title: 'Ресурсы', count: () => list('totalFields').length, render: renderResources },
		{ id: 'parameters', title: 'Параметры', count: () => list('parameters').length, render: renderParameters },
		{ id: 'variants', title: 'Варианты', count: () => list('settingsVariants').length, render: renderVariants },
		{ id: 'nested', title: 'Вложенные схемы', count: () => list('nestedSchemas').length, render: renderNested },
	];
	let activeTabId = 'dataSets';

	function list(key) {
		return Array.isArray(model[key]) ? model[key] : [];
	}

	function sectionTitle(text) {
		const el = document.createElement('div');
		el.className = 'section-title';
		el.textContent = text;
		return el;
	}

	/** Строка списка в общем виде панелей: имя, пояснение и правое значение. */
	function structItem(row) {
		const item = document.createElement('div');
		item.className = 'struct-item';
		const nameEl = document.createElement('span');
		nameEl.className = 'struct-item-name';
		nameEl.textContent = row.name || '';
		if (row.hint) {
			nameEl.title = row.hint;
		}
		item.appendChild(nameEl);
		if (row.value) {
			const valueEl = document.createElement('span');
			valueEl.className = 'struct-item-syn';
			valueEl.textContent = row.value;
			item.appendChild(valueEl);
		}
		if (row.right) {
			const rightEl = document.createElement('span');
			rightEl.className = 'struct-item-syn ref-selected-mode';
			rightEl.textContent = row.right;
			item.appendChild(rightEl);
		}
		return item;
	}

	function listSection(host, rows) {
		const el = document.createElement('div');
		el.className = 'struct-list';
		for (const row of rows) {
			el.appendChild(structItem(row));
		}
		host.appendChild(el);
	}

	function emptyNote(host, text) {
		const el = document.createElement('div');
		el.className = 'empty';
		el.textContent = text;
		host.appendChild(el);
	}

	function renderDataSets(host) {
		const sources = list('dataSources');
		if (sources.length > 0) {
			host.appendChild(sectionTitle('Источники данных'));
			listSection(
				host,
				sources.map((source) => ({
					name: source.name || '',
					value: source.type || '',
					right: source.connectionString || '',
				}))
			);
		}
		const sets = list('dataSets');
		if (sets.length === 0) {
			emptyNote(host, 'Наборов данных нет.');
			return;
		}
		for (const dataSet of sets) {
			const section = document.createElement('div');
			section.className = 'dcs-section';
			section.appendChild(sectionTitle('Набор данных: ' + (dataSet.name || '')));
			const fields = Array.isArray(dataSet.fields) ? dataSet.fields : [];
			if (fields.length > 0) {
				listSection(
					section,
					fields.map((field) => ({
						name: field.dataPath || '',
						value: field.title || '',
						right: field.field || '',
					}))
				);
			}
			if (typeof dataSet.query === 'string') {
				const query = document.createElement('textarea');
				query.className = 'dcs-query';
				query.value = dataSet.query;
				query.spellcheck = false;
				section.appendChild(query);
				const actions = document.createElement('div');
				actions.className = 'dcs-actions';
				const save = document.createElement('button');
				save.type = 'button';
				save.className = 'primary-btn';
				save.textContent = 'Сохранить запрос';
				save.addEventListener('click', function () {
					if (saving) {
						return;
					}
					saving = true;
					statusEl.textContent = 'Сохраняем…';
					vscode.postMessage({ type: 'setQuery', dataSet: dataSet.name || '', text: query.value });
				});
				actions.appendChild(save);
				section.appendChild(actions);
			}
			host.appendChild(section);
		}
	}

	function renderLinks(host) {
		const links = list('dataSetLinks');
		if (links.length === 0) {
			emptyNote(host, 'Связей между наборами нет.');
			return;
		}
		listSection(
			host,
			links.map((link) => ({
				name: (link.source || '') + ' → ' + (link.destination || ''),
				value: link.sourceExpression || '',
				right: link.destinationExpression || '',
			}))
		);
	}

	function renderCalculated(host) {
		const fields = list('calculatedFields');
		if (fields.length > 0) {
			listSection(host, fields.map((field) => ({ name: field.name || '', value: field.value || '' })));
		} else {
			emptyNote(host, 'Вычисляемых полей нет.');
		}

		const grid = document.createElement('div');
		grid.className = 'dcs-add-grid';
		const inputs = {};
		for (const pair of [
			['dataPath', 'Путь к данным'],
			['expression', 'Выражение'],
			['title', 'Заголовок'],
		]) {
			const label = document.createElement('label');
			label.textContent = pair[1];
			grid.appendChild(label);
			const input = document.createElement('input');
			input.type = 'text';
			inputs[pair[0]] = input;
			grid.appendChild(input);
		}
		host.appendChild(grid);

		const actions = document.createElement('div');
		actions.className = 'dcs-actions';
		const addBtn = document.createElement('button');
		addBtn.type = 'button';
		addBtn.className = 'primary-btn';
		addBtn.textContent = 'Добавить поле';
		addBtn.addEventListener('click', function () {
			if (saving) {
				return;
			}
			if (!inputs.dataPath.value.trim() || !inputs.expression.value.trim()) {
				statusEl.textContent = 'Заполните путь к данным и выражение.';
				return;
			}
			saving = true;
			statusEl.textContent = 'Сохраняем…';
			vscode.postMessage({
				type: 'addCalculatedField',
				dataPath: inputs.dataPath.value.trim(),
				expression: inputs.expression.value.trim(),
				title: inputs.title.value.trim(),
			});
		});
		actions.appendChild(addBtn);
		host.appendChild(actions);
	}

	function renderResources(host) {
		const totals = list('totalFields');
		if (totals.length === 0) {
			emptyNote(host, 'Ресурсов нет.');
			return;
		}
		listSection(host, totals.map((item) => ({ name: item.name || '', value: item.value || '' })));
	}

	function renderParameters(host) {
		const params = list('parameters');
		if (params.length === 0) {
			emptyNote(host, 'Параметров нет.');
			return;
		}
		listSection(
			host,
			params.map((item) => ({
				name: item.name || '',
				value: item.title || '',
				right: [item.type, item.value ? '= ' + item.value : '', item.expression || '']
					.filter(Boolean)
					.join(' • '),
			}))
		);
	}

	function renderVariants(host) {
		const variants = list('settingsVariants');
		if (variants.length === 0) {
			emptyNote(host, 'Вариантов настроек нет.');
			return;
		}
		listSection(host, variants.map((item) => ({ name: item.name || '', value: item.value || '' })));
	}

	function renderNested(host) {
		const nested = list('nestedSchemas');
		if (nested.length === 0) {
			emptyNote(host, 'Вложенных схем нет.');
			return;
		}
		listSection(host, nested.map((item) => ({ name: item.name || '', value: item.value || '' })));
	}

	function visibleTabs() {
		return TABS.filter((tab) => tab.always === true || tab.count() > 0);
	}

	function renderTabs() {
		const tabs = visibleTabs();
		if (!tabs.some((tab) => tab.id === activeTabId)) {
			activeTabId = tabs[0] ? tabs[0].id : '';
		}
		tabsRoot.textContent = '';
		for (const tab of tabs) {
			const button = document.createElement('button');
			button.type = 'button';
			button.className = 'tab' + (tab.id === activeTabId ? ' active' : '');
			const count = tab.count();
			button.textContent = count > 0 ? tab.title + ' (' + count + ')' : tab.title;
			button.addEventListener('click', function () {
				activeTabId = tab.id;
				renderTabs();
				renderContent();
			});
			tabsRoot.appendChild(button);
		}
	}

	function renderContent() {
		contentRoot.textContent = '';
		const tab = visibleTabs().find(function (candidate) {
			return candidate.id === activeTabId;
		});
		if (!tab) {
			emptyNote(contentRoot, 'Схема пуста.');
			return;
		}
		tab.render(contentRoot);
	}

	window.addEventListener('message', function (event) {
		const msg = event.data;
		if (!msg || typeof msg !== 'object' || msg.type !== 'saved') {
			return;
		}
		saving = false;
		statusEl.textContent = msg.ok ? 'Сохранено' : String(msg.error || 'Ошибка сохранения');
		if (msg.ok && msg.model) {
			model = msg.model;
			renderTabs();
			renderContent();
		}
	});

	renderTabs();
	renderContent();
})();
