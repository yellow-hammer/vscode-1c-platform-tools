(function () {
	const vscode = acquireVsCodeApi();
	const initial = window.__INITIAL_DATA__ || {};
	const sourceKind = window.__SOURCE_KIND__ || '';
	const dictionaries = window.__DICTIONARIES__ || { enums: {}, labels: { values: {}, byProperty: {} } };
	const support = window.__SUPPORT__ || null;
	const statusEl = document.getElementById('status');

/** Плашка запрета: овсянка, суть и что делать дальше. */
	function readonlyNotice(lead, next) {
		const item = document.createElement('div');
		item.className = 'warning-item warning-item-readonly';
		const text = document.createElement('div');
		text.className = 'warning-text';
		const head = document.createElement('strong');
		head.textContent = lead;
		text.appendChild(head);
		if (next) {
			const hint = document.createElement('span');
			hint.className = 'warning-next';
			hint.textContent = next;
			text.appendChild(hint);
		}
		item.appendChild(text);
		return item;
	}

		/** Поддержка поставщика: бейдж в шапке и запрет правки при полной поддержке. */
	function applySupportState() {
		const host = document.getElementById('originBadges');
		if (host && support && support.configurationState) {
			const badge = document.createElement('span');
			// корень закрыт своим правилом либо возможность изменения ещё не включена
			const locked = support.rootState === 'locked' || support.editingEnabled === false;
			badge.className = 'origin-badge ' + (locked ? 'origin-badge-locked' : 'origin-badge-support');
			badge.textContent = support.editingEnabled === false
				? 'На поддержке: изменение не включено'
				: (locked ? 'На поддержке: изменение запрещено' : 'На поддержке: изменение разрешено');
			const hint = [];
			if (support.vendor) {
				hint.push('Поставщик: ' + support.vendor);
			}
			if (support.version) {
				hint.push('Версия поставки: ' + support.version);
			}
			badge.title = hint.join(' • ');
			host.appendChild(badge);
		}
		const closed = support
			&& (support.rootState === 'locked' || support.editingEnabled === false);
		if (!closed) {
			return;
		}
		const notice = document.getElementById('readonlyNotice');
		if (notice) {
			notice.classList.remove('hidden');
			notice.appendChild(support.editingEnabled === false
				? readonlyNotice(
					'Конфигурация на поддержке, возможность изменения не включена: свойства только на просмотр.',
					'Включите возможность изменения в конфигураторе. Из дерева метаданных доступно только'
						+ ' снятие с поддержки.'
				)
				: readonlyNotice(
					'Корень конфигурации не редактируется: свойства только на просмотр.',
					'Смените правило поддержки корня конфигурации или снимите её с поддержки.'
				));
		}
		for (const el of document.querySelectorAll('.edit-input')) {
			el.disabled = true;
		}
		for (const el of document.querySelectorAll('#defaultRoles button, #usePurposes input')) {
			el.disabled = true;
		}
		const save = document.getElementById('saveBtn');
		if (save) {
			save.disabled = true;
		}
	}

	/** Подпись значения: словарь md-sparrow, версии собираются из имени. */
	function valueLabel(property, name) {
		if (!name) {
			return '';
		}
		const special = (dictionaries.labels.byProperty['configuration.' + property] || {})[name];
		if (special) {
			return special;
		}
		const known = dictionaries.labels.values[name];
		if (known) {
			return known;
		}
		const version = /^VERSION_(\d+)_(\d+)(?:_(\d+))?$/.exec(name);
		if (version) {
			return 'Версия ' + version[1] + '.' + version[2] + (version[3] ? '.' + version[3] : '');
		}
		return name;
	}

	function initSelect(id, selected) {
		const el = document.getElementById(id);
		el.textContent = '';
		const values = (dictionaries.enums[id] || []).slice();
		// Значение вне словаря формата остаётся выбираемым, а не теряется
		if (selected && !values.includes(selected)) {
			values.unshift(selected);
		}
		// Свойства нет в файле - пустой вариант: иначе сохранение дописало бы
		// в выгрузку значение, которого там не было
		const empty = document.createElement('option');
		empty.value = '';
		empty.textContent = 'Не задано';
		el.appendChild(empty);
		for (const v of values) {
			const opt = document.createElement('option');
			opt.value = v;
			opt.textContent = valueLabel(id, v);
			el.appendChild(opt);
		}
		el.value = selected && values.includes(selected) ? selected : '';
	}

	function setValue(id, value) {
		const el = document.getElementById(id);
		if (!el) {
			return;
		}
		el.value = value || '';
	}

	/** Список флажков: значения с подписями, отмеченные собираются по data-value. */
	function initCheckList(id, values, selected, labelOf) {
		const el = document.getElementById(id);
		el.textContent = '';
		const all = values.slice();
		// Отмеченное значение вне словаря остаётся видимым и снимаемым
		for (const v of selected || []) {
			if (!all.includes(v)) {
				all.push(v);
			}
		}
		for (const v of all) {
			const label = document.createElement('label');
			const box = document.createElement('input');
			box.type = 'checkbox';
			box.dataset.value = v;
			box.checked = (selected || []).includes(v);
			label.appendChild(box);
			label.appendChild(document.createTextNode(' ' + labelOf(v)));
			el.appendChild(label);
		}
	}

	/** Основные роли: плашки с удалением, добавление через подбор в редакторе. */
	let selectedRoles = [];

	function renderRoleChips() {
		const el = document.getElementById('defaultRoles');
		el.textContent = '';
		for (const role of selectedRoles) {
			const chip = document.createElement('span');
			chip.className = 'edit-chip edit-chip-action';
			const name = document.createElement('span');
			name.textContent = String(role).replace(/^Role\./, '');
			name.title = role;
			chip.appendChild(name);
			const remove = document.createElement('button');
			remove.type = 'button';
			remove.className = 'edit-chip-remove';
			remove.title = 'Убрать роль';
			remove.textContent = '✕';
			remove.addEventListener('click', (function (target) {
				return function () {
					selectedRoles = selectedRoles.filter(function (candidate) { return candidate !== target; });
					renderRoleChips();
				};
			})(role));
			chip.appendChild(remove);
			el.appendChild(chip);
		}
		const add = document.createElement('button');
		add.type = 'button';
		add.className = 'struct-add-btn';
		add.textContent = '+ Роль…';
		add.addEventListener('click', function () {
			vscode.postMessage({ type: 'pickRole', taken: selectedRoles.slice() });
		});
		el.appendChild(add);
	}

	function collectCheckList(id) {
		const out = [];
		for (const box of document.getElementById(id).querySelectorAll('input[type="checkbox"]')) {
			if (box.checked) {
				out.push(box.dataset.value);
			}
		}
		return out;
	}

	function collect() {
		return {
			name: document.getElementById('name').value.trim(),
			synonymRu: document.getElementById('synonymRu').value,
			comment: document.getElementById('comment').value,
			defaultRunMode: document.getElementById('defaultRunMode').value,
			usePurposes: collectCheckList('usePurposes'),
			scriptVariant: document.getElementById('scriptVariant').value,
			defaultRoles: selectedRoles.slice(),
			managedApplicationModule: initial.managedApplicationModule || '',
			sessionModule: initial.sessionModule || '',
			externalConnectionModule: initial.externalConnectionModule || '',
			briefInformationRu: document.getElementById('briefInformationRu').value,
			detailedInformationRu: document.getElementById('detailedInformationRu').value,
			copyrightRu: document.getElementById('copyrightRu').value,
			vendorInformationAddressRu: document.getElementById('vendorInformationAddressRu').value,
			configurationInformationAddressRu: document.getElementById('configurationInformationAddressRu').value,
			vendor: document.getElementById('vendor').value,
			version: document.getElementById('version').value,
			updateCatalogAddress: document.getElementById('updateCatalogAddress').value,
			dataLockControlMode: document.getElementById('dataLockControlMode').value,
			objectAutonumerationMode: document.getElementById('objectAutonumerationMode').value,
			modalityUseMode: document.getElementById('modalityUseMode').value,
			synchronousPlatformExtensionAndAddInCallUseMode: document.getElementById('synchronousPlatformExtensionAndAddInCallUseMode').value,
			interfaceCompatibilityMode: document.getElementById('interfaceCompatibilityMode').value,
			compatibilityMode: document.getElementById('compatibilityMode').value
		};
	}

	function fillFromDto(dto) {
		setValue('name', dto.name);
		setValue('synonymRu', dto.synonymRu);
		setValue('comment', dto.comment);
		initCheckList('usePurposes', dto.usePurposeOptions || [], dto.usePurposes || [], (v) => valueLabel('usePurposes', v));
		selectedRoles = (dto.defaultRoles || []).slice();
		renderRoleChips();
		setValue('briefInformationRu', dto.briefInformationRu);
		setValue('detailedInformationRu', dto.detailedInformationRu);
		setValue('copyrightRu', dto.copyrightRu);
		setValue('vendorInformationAddressRu', dto.vendorInformationAddressRu);
		setValue('configurationInformationAddressRu', dto.configurationInformationAddressRu);
		setValue('vendor', dto.vendor);
		setValue('version', dto.version);
		setValue('updateCatalogAddress', dto.updateCatalogAddress);

		initSelect('defaultRunMode', dto.defaultRunMode);
		initSelect('scriptVariant', dto.scriptVariant);
		initSelect('dataLockControlMode', dto.dataLockControlMode);
		initSelect('objectAutonumerationMode', dto.objectAutonumerationMode);
		initSelect('modalityUseMode', dto.modalityUseMode);
		initSelect(
			'synchronousPlatformExtensionAndAddInCallUseMode',
			dto.synchronousPlatformExtensionAndAddInCallUseMode
		);
		initSelect('interfaceCompatibilityMode', dto.interfaceCompatibilityMode);
		initSelect('compatibilityMode', dto.compatibilityMode);
	}

	document.getElementById('openExternalConnectionModule').addEventListener('click', () => {
		vscode.postMessage({ type: 'openModule', module: 'externalConnection' });
	});
	document.getElementById('openApplicationModule').addEventListener('click', () => {
		vscode.postMessage({ type: 'openModule', module: 'application' });
	});
	document.getElementById('openSessionModule').addEventListener('click', () => {
		vscode.postMessage({ type: 'openModule', module: 'session' });
	});
	document.getElementById('saveBtn').addEventListener('click', () => {
		statusEl.textContent = 'Сохраняем...';
		vscode.postMessage({ type: 'save', payload: collect() });
	});


	// Ctrl+S приходит командой из расширения: внутри webview его перехватывает VS Code
	window.addEventListener('message', (event) => {
		if (!event.data || event.data.type !== 'saveRequested') {
			return;
		}
		const button = /** @type {HTMLButtonElement | null} */ (document.getElementById('saveBtn'));
		if (button && !button.disabled) {
			button.click();
		}
	});

	window.addEventListener('message', (event) => {
		const picked = event.data;
		if (picked && typeof picked === 'object' && picked.type === 'rolePicked' && typeof picked.role === 'string') {
			if (!selectedRoles.includes(picked.role)) {
				selectedRoles.push(picked.role);
				renderRoleChips();
			}
			return;
		}
		const msg = event.data;
		if (!msg || typeof msg !== 'object' || msg.type !== 'saved') {
			return;
		}
		if (msg.ok) {
			statusEl.textContent = 'Сохранено';
		} else {
			statusEl.textContent = 'Ошибка сохранения';
		}
		if (msg.payload) {
			fillFromDto(msg.payload);
		}
	});

	fillFromDto(initial);
	applySupportState();

	if (sourceKind === 'externalErf' || sourceKind === 'externalEpf') {
		const modulesSection = document.getElementById('modulesSection');
		if (modulesSection) {
			modulesSection.classList.add('hidden');
		}
	}
})();
