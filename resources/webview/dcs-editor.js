(function () {
	const vscode = acquireVsCodeApi();
	let model = window.__INITIAL_DATA__ || {};
	const contentRoot = document.getElementById('content');
	const statusEl = document.getElementById('status');
	let saving = false;

	function sectionTitle(text) {
		const el = document.createElement('div');
		el.className = 'section-title';
		el.textContent = text;
		return el;
	}

	function structItem(name, value, right) {
		const item = document.createElement('div');
		item.className = 'struct-item';
		const nameEl = document.createElement('span');
		nameEl.className = 'struct-item-name';
		nameEl.textContent = name;
		item.appendChild(nameEl);
		if (value) {
			const valueEl = document.createElement('span');
			valueEl.className = 'struct-item-syn';
			valueEl.textContent = value;
			item.appendChild(valueEl);
		}
		if (right) {
			const rightEl = document.createElement('span');
			rightEl.className = 'struct-item-syn ref-selected-mode';
			rightEl.textContent = right;
			item.appendChild(rightEl);
		}
		return item;
	}

	function render() {
		contentRoot.textContent = '';

		const sets = Array.isArray(model.dataSets) ? model.dataSets : [];
		for (const dataSet of sets) {
			const section = document.createElement('div');
			section.className = 'dcs-section';
			section.appendChild(sectionTitle('Набор данных: ' + (dataSet.name || '')));
			if (Array.isArray(dataSet.fields) && dataSet.fields.length > 0) {
				const list = document.createElement('div');
				list.className = 'struct-list';
				for (const field of dataSet.fields) {
					// Заголовок поля видим там же, где его показывает конфигуратор
					list.appendChild(structItem(field.dataPath || '', field.title || '', field.field || ''));
				}
				section.appendChild(list);
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
				save.className = 'dcs-btn';
				save.textContent = 'Сохранить запрос';
				save.addEventListener('click', function () {
					if (saving) {
						return;
					}
					saving = true;
					statusEl.textContent = 'Сохраняем...';
					vscode.postMessage({ type: 'setQuery', dataSet: dataSet.name || '', text: query.value });
				});
				actions.appendChild(save);
				section.appendChild(actions);
			}
			contentRoot.appendChild(section);
		}
		if (sets.length === 0) {
			const empty = document.createElement('div');
			empty.className = 'empty';
			empty.textContent = 'Наборов данных нет.';
			contentRoot.appendChild(empty);
		}

		const calc = document.createElement('div');
		calc.className = 'dcs-section';
		calc.appendChild(sectionTitle('Вычисляемые поля'));
		const calcFields = Array.isArray(model.calculatedFields) ? model.calculatedFields : [];
		if (calcFields.length > 0) {
			const list = document.createElement('div');
			list.className = 'struct-list';
			for (const field of calcFields) {
				list.appendChild(structItem(field.name || '', field.value || ''));
			}
			calc.appendChild(list);
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
		calc.appendChild(grid);
		const calcActions = document.createElement('div');
		calcActions.className = 'dcs-actions';
		const addBtn = document.createElement('button');
		addBtn.type = 'button';
		addBtn.className = 'dcs-btn';
		addBtn.textContent = 'Добавить поле';
		addBtn.addEventListener('click', function () {
			if (saving || !inputs.dataPath.value.trim() || !inputs.expression.value.trim()) {
				statusEl.textContent = !saving ? 'Заполните путь к данным и выражение.' : statusEl.textContent;
				return;
			}
			saving = true;
			statusEl.textContent = 'Сохраняем...';
			vscode.postMessage({
				type: 'addCalculatedField',
				dataPath: inputs.dataPath.value.trim(),
				expression: inputs.expression.value.trim(),
				title: inputs.title.value.trim(),
			});
		});
		calcActions.appendChild(addBtn);
		calc.appendChild(calcActions);
		contentRoot.appendChild(calc);

		const totals = Array.isArray(model.totalFields) ? model.totalFields : [];
		if (totals.length > 0) {
			const section = document.createElement('div');
			section.className = 'dcs-section';
			section.appendChild(sectionTitle('Итоговые поля'));
			const list = document.createElement('div');
			list.className = 'struct-list';
			for (const item of totals) {
				list.appendChild(structItem(item.name || '', item.value || ''));
			}
			section.appendChild(list);
			contentRoot.appendChild(section);
		}

		const params = Array.isArray(model.parameters) ? model.parameters : [];
		if (params.length > 0) {
			const section = document.createElement('div');
			section.className = 'dcs-section';
			section.appendChild(sectionTitle('Параметры'));
			const list = document.createElement('div');
			list.className = 'struct-list';
			for (const item of params) {
				const right = [item.type, item.value ? '= ' + item.value : '', item.expression || '']
					.filter(Boolean)
					.join(' • ');
				list.appendChild(structItem(item.name || '', item.title || '', right));
			}
			section.appendChild(list);
			contentRoot.appendChild(section);
		}
	}

	window.addEventListener('message', function (event) {
		const msg = event.data;
		if (!msg || typeof msg !== 'object') {
			return;
		}
		if (msg.type === 'saved') {
			saving = false;
			statusEl.textContent = msg.ok ? 'Сохранено' : String(msg.error || 'Ошибка сохранения');
			if (msg.ok && msg.model) {
				model = msg.model;
				render();
			}
		}
	});

	render();
})();
