(function () {
	'use strict';

	/** @type {HTMLElement | null} */
	const initialEl = document.getElementById('metadata-object-initial');
	const raw = initialEl ? initialEl.textContent : '{}';
	/** @type {{tabs?: Array<{id:string,title:string,count?:number,render:string,data?:unknown}>, warnings?: string[], internalName?: string, objectKind?: string, objectKindLabel?: string, objectType?: string, synonymRu?: string, comment?: string, objectXmlPath?: string, technicalJson?: string}} */
	let model = {};
	try {
		model = JSON.parse(raw || '{}');
	} catch {
		model = {};
	}

	/** @type {HTMLElement | null} */
	const tabsRoot = document.getElementById('tabs');
	/** @type {HTMLElement | null} */
	const contentRoot = document.getElementById('content');
	/** @type {HTMLElement | null} */
	const warningsRoot = document.getElementById('warnings');
	/** @type {HTMLElement | null} */
	const technicalRoot = document.getElementById('technical');
	/** @type {HTMLElement | null} */
	const technicalJsonRoot = document.getElementById('technicalJson');
	/** @type {HTMLButtonElement | null} */
	const toggleTechnicalButton = /** @type {HTMLButtonElement | null} */ (document.getElementById('toggleTechnical'));

	const tabs = Array.isArray(model.tabs) ? model.tabs : [];
	let activeTabId = tabs[0] ? tabs[0].id : '';
	let technicalVisible = false;
	const genericValueLabels = {
		Use: 'Использовать',
		DontUse: 'Не использовать',
		Auto: 'Авто',
		Managed: 'Управляемый',
		Directly: 'Непосредственно',
		Begin: 'С начала',
		BothWays: 'Оба способа',
		String: 'Строка',
		Number: 'Число',
		Variable: 'Переменная',
		Fixed: 'Фиксированная',
		Items: 'Элементы',
		Folders: 'Группы',
		FoldersAndItems: 'Группы и элементы',
		ToItems: 'К элементам',
		ToFolders: 'К группам',
		ToFoldersAndItems: 'К группам и элементам',
		AsDescription: 'Как наименование',
		AsCode: 'Как код',
		WholeCatalog: 'Во всем справочнике',
		Adopted: 'Заимствованный',
		HierarchyFoldersAndItems: 'Иерархия групп и элементов',
	};
	const refKindLabels = {
		Catalog: 'Справочник',
		CatalogRef: 'Справочник',
		Document: 'Документ',
		DocumentRef: 'Документ',
		DocumentJournal: 'Журнал документов',
		DocumentJournalRef: 'Журнал документов',
		Enum: 'Перечисление',
		EnumRef: 'Перечисление',
		Report: 'Отчет',
		ReportRef: 'Отчет',
		DataProcessor: 'Обработка',
		DataProcessorRef: 'Обработка',
		InformationRegister: 'Регистр сведений',
		InformationRegisterRef: 'Регистр сведений',
		AccumulationRegister: 'Регистр накопления',
		AccumulationRegisterRef: 'Регистр накопления',
		AccountingRegister: 'Регистр бухгалтерии',
		AccountingRegisterRef: 'Регистр бухгалтерии',
		CalculationRegister: 'Регистр расчета',
		CalculationRegisterRef: 'Регистр расчета',
		ChartOfAccounts: 'План счетов',
		ChartOfAccountsRef: 'План счетов',
		ChartOfCharacteristicTypes: 'План видов характеристик',
		ChartOfCharacteristicTypesRef: 'План видов характеристик',
		ChartOfCalculationTypes: 'План видов расчета',
		ChartOfCalculationTypesRef: 'План видов расчета',
		BusinessProcess: 'Бизнес-процесс',
		BusinessProcessRef: 'Бизнес-процесс',
		Task: 'Задача',
		TaskRef: 'Задача',
		ExchangePlan: 'План обмена',
		ExchangePlanRef: 'План обмена',
		CommonModule: 'Общий модуль',
		CommonModuleRef: 'Общий модуль',
		Subsystem: 'Подсистема',
		SubsystemRef: 'Подсистема',
		Constant: 'Константа',
		ConstantRef: 'Константа',
	};

	function renderWarnings() {
		if (!warningsRoot) {
			return;
		}
		const warnings = Array.isArray(model.warnings) ? model.warnings : [];
		if (warnings.length === 0) {
			warningsRoot.classList.add('hidden');
			warningsRoot.innerHTML = '';
			return;
		}
		warningsRoot.classList.remove('hidden');
		warningsRoot.innerHTML = warnings
			.map((warning) => `<div class="warning-item">${escapeHtml(String(warning))}</div>`)
			.join('');
	}

	function renderTabs() {
		if (!tabsRoot) {
			return;
		}
		tabsRoot.innerHTML = '';
		for (const tab of tabs) {
			const button = document.createElement('button');
			button.type = 'button';
			button.className = 'tab' + (tab.id === activeTabId ? ' active' : '');
			const countText = typeof tab.count === 'number' ? ` (${tab.count})` : '';
			button.textContent = `${tab.title}${countText}`;
			button.addEventListener('click', function () {
				activeTabId = tab.id;
				renderTabs();
				renderContent();
			});
			tabsRoot.appendChild(button);
		}
	}

	function renderContent() {
		if (!contentRoot) {
			return;
		}
		const tab = tabs.find((item) => item.id === activeTabId);
		if (!tab) {
			contentRoot.innerHTML = '<div class="empty">Нет данных.</div>';
			return;
		}
		switch (tab.render) {
			case 'overview':
				renderOverview();
				return;
			case 'named':
				renderNamed(tab.data);
				return;
			case 'tabular':
				renderTabular(tab.data);
				return;
			case 'list':
				renderList(tab.data);
				return;
			case 'kv':
				renderKv(tab.data);
				return;
			case 'json':
				renderJson(tab.data);
				return;
			case 'subsystemContent':
				renderSubsystemContent(tab.data);
				return;
			default:
				contentRoot.innerHTML = '<div class="empty">Нет данных.</div>';
		}
	}

	function renderOverview() {
		if (!contentRoot) {
			return;
		}
		const mainFields = [
			{ label: 'Вид', value: model.objectKindLabel || model.objectKind || model.objectType || '' },
			{ label: 'Имя', value: model.internalName || '' },
			{ label: 'Синоним', value: model.synonymRu || '' },
			{ label: 'Комментарий', value: model.comment || '' },
		];
		const locationFields = [{ label: 'XML файл', value: model.objectXmlPath || '' }];
		contentRoot.innerHTML = `
			<div class="section-title">Основные</div>
			<div class="overview-grid">${mainFields
			.map(
				(field) => `<div class="field">
						<div class="field-label">${escapeHtml(field.label)}</div>
						<div class="field-value">${escapeHtml(toDisplayText(field.value))}</div>
					</div>`
			)
			.join('')}</div>
			<div class="section-title section-title-spaced">Расположение</div>
			<div class="overview-grid">${locationFields
				.map(
					(field) => `<div class="field">
						<div class="field-label">${escapeHtml(field.label)}</div>
						<div class="field-value">${escapeHtml(toDisplayText(field.value))}</div>
					</div>`
				)
				.join('')}</div>`;
	}

	function renderNamed(data) {
		if (!contentRoot) {
			return;
		}
		const items = Array.isArray(data) ? data : [];
		if (items.length === 0) {
			contentRoot.innerHTML = '<div class="empty">Нет данных.</div>';
			return;
		}
		contentRoot.innerHTML = `<div class="named-list">${items
			.map((raw) => {
				const item = asObject(raw);
				const name = toDisplayText(item.name);
				const synonym = toDisplayText(item.synonymRu);
				const comment = toDisplayText(item.comment);
				return `<div class="named-item">
						<div class="item-title">${escapeHtml(name)}</div>
						<div class="item-grid">
							<div>
								<div class="field-label">Синоним</div>
								<div class="field-value">${escapeHtml(synonym)}</div>
							</div>
							<div>
								<div class="field-label">Комментарий</div>
								<div class="field-value">${escapeHtml(comment)}</div>
							</div>
						</div>
					</div>`;
			})
			.join('')}</div>`;
	}

	function renderTabular(data) {
		if (!contentRoot) {
			return;
		}
		const items = Array.isArray(data) ? data : [];
		if (items.length === 0) {
			contentRoot.innerHTML = '<div class="empty">Нет данных.</div>';
			return;
		}
		contentRoot.innerHTML = `<div class="tabular-list">${items
			.map((raw) => {
				const item = asObject(raw);
				const name = toDisplayText(item.name);
				const synonym = toDisplayText(item.synonymRu);
				const comment = toDisplayText(item.comment);
				const attrs = Array.isArray(item.attributes) ? item.attributes.map((x) => asObject(x)).filter(Boolean) : [];
				const attrsHtml =
					attrs.length > 0
						? `<div class="nested-list">${attrs
								.map((attr) => {
									const attrName = toDisplayText(attr.name);
									const attrSynonym = toDisplayText(attr.synonymRu);
									const attrComment = toDisplayText(attr.comment);
									return `<div class="nested-item">
										<div class="nested-title">${escapeHtml(attrName)}</div>
										<div class="item-grid">
											<div>
												<div class="field-label">Синоним</div>
												<div class="field-value">${escapeHtml(attrSynonym)}</div>
											</div>
											<div>
												<div class="field-label">Комментарий</div>
												<div class="field-value">${escapeHtml(attrComment)}</div>
											</div>
										</div>
									</div>`;
								})
								.join('')}</div>`
						: '<div class="empty">Реквизитов нет.</div>';
				return `<div class="tabular-item">
						<details class="tabular-details">
							<summary class="tabular-summary">
								<span class="item-title">${escapeHtml(name)}</span>
								<span class="tabular-meta">${escapeHtml(synonym)}</span>
							</summary>
							<div class="tabular-details-content">
						<div class="item-grid">
							<div>
								<div class="field-label">Синоним</div>
								<div class="field-value">${escapeHtml(synonym)}</div>
							</div>
							<div>
								<div class="field-label">Комментарий</div>
								<div class="field-value">${escapeHtml(comment)}</div>
							</div>
							<div>
								<div class="field-label">Реквизиты табличной части</div>
								${attrsHtml}
							</div>
						</div>
							</div>
						</details>
					</div>`;
			})
			.join('')}</div>`;
	}

	function renderSubsystemContent(data) {
		if (!contentRoot) {
			return;
		}
		const source = asObject(data);
		const summary = Array.isArray(source.summary) ? source.summary.map((x) => asObject(x)) : [];
		const items = Array.isArray(source.items) ? source.items.map((item) => toDisplayText(item)).filter(Boolean) : [];
		const summaryHtml =
			summary.length > 0
				? `<div class="summary-list">${summary
						.map((item) => `<div class="summary-item">
							<div class="summary-key">${escapeHtml(toDisplayText(item.type))}</div>
							<div class="summary-value">${escapeHtml(toDisplayText(item.count))}</div>
						</div>`)
						.join('')}</div>`
				: '<div class="empty">Нет данных для сводки.</div>';
		const itemsHtml =
			items.length > 0
				? `<div id="subsystemContentList" class="list">${items
						.map(
							(item, index) => `<div class="list-item">
								<div class="list-index">${index + 1}.</div>
								<div class="list-text">${escapeHtml(item)}</div>
							</div>`
						)
						.join('')}</div>`
				: '<div class="empty">Нет элементов состава.</div>';

		contentRoot.innerHTML = `
			<div class="section-title">Сводка по типам</div>
			${summaryHtml}
			<div class="section-title section-title-spaced">Полный состав</div>
			<div class="list-tools">
				<input id="subsystemContentFilter" class="list-filter" type="text" placeholder="Фильтр по составу..." />
			</div>
			${itemsHtml}`;

		const filterInput = /** @type {HTMLInputElement | null} */ (document.getElementById('subsystemContentFilter'));
		const listRoot = document.getElementById('subsystemContentList');
		if (!filterInput || !listRoot) {
			return;
		}
		filterInput.addEventListener('input', function () {
			const query = filterInput.value.trim().toLowerCase();
			const rows = listRoot.querySelectorAll('.list-item');
			for (const row of rows) {
				const text = row.textContent ? row.textContent.toLowerCase() : '';
				row.classList.toggle('hidden', query.length > 0 && !text.includes(query));
			}
		});
	}

	function renderList(data) {
		if (!contentRoot) {
			return;
		}
		const items = Array.isArray(data) ? data.map((item) => toDisplayText(item)).filter(Boolean) : [];
		if (items.length === 0) {
			contentRoot.innerHTML = '<div class="empty">Нет данных.</div>';
			return;
		}
		contentRoot.innerHTML = `
			<div class="list-tools">
				<input id="listFilterInput" class="list-filter" type="text" placeholder="Фильтр по списку..." />
			</div>
			<div id="listRoot" class="list">${items
			.map(
				(item, index) => `<div class="list-item">
					<div class="list-index">${index + 1}.</div>
					<div class="list-text">${escapeHtml(item)}</div>
				</div>`
			)
			.join('')}</div>`;
		const filterInput = /** @type {HTMLInputElement | null} */ (document.getElementById('listFilterInput'));
		const listRoot = document.getElementById('listRoot');
		if (!filterInput || !listRoot) {
			return;
		}
		filterInput.addEventListener('input', function () {
			const query = filterInput.value.trim().toLowerCase();
			const rows = listRoot.querySelectorAll('.list-item');
			for (const row of rows) {
				const text = row.textContent ? row.textContent.toLowerCase() : '';
				row.classList.toggle('hidden', query.length > 0 && !text.includes(query));
			}
		});
	}

	function renderKv(data) {
		if (!contentRoot) {
			return;
		}
		const source = asObject(data);
		const entries = Object.entries(source);
		if (entries.length === 0) {
			contentRoot.innerHTML = '<div class="empty">Нет данных.</div>';
			return;
		}
		contentRoot.innerHTML = `<div class="kv-list">${entries
			.map(
				([key, value]) => `<div class="kv-row">
						<div class="kv-key">${escapeHtml(key)}</div>
						<div class="kv-value">${escapeHtml(toDisplayText(value))}</div>
					</div>`
			)
			.join('')}</div>`;
	}

	function renderJson(data) {
		if (!contentRoot) {
			return;
		}
		const formatted = JSON.stringify(data ?? {}, null, 2);
		contentRoot.innerHTML = `<pre class="code">${escapeHtml(formatted)}</pre>`;
	}

	function renderTechnical() {
		if (!technicalRoot || !technicalJsonRoot || !toggleTechnicalButton) {
			return;
		}
		if (!technicalVisible) {
			technicalRoot.classList.add('hidden');
			toggleTechnicalButton.textContent = 'Технические данные';
			return;
		}
		technicalRoot.classList.remove('hidden');
		toggleTechnicalButton.textContent = 'Скрыть технические данные';
		technicalJsonRoot.textContent = model.technicalJson || '{}';
	}

	function toDisplayText(value) {
		if (value === null || value === undefined || value === '') {
			return '(пусто)';
		}
		if (typeof value === 'string') {
			const metadataRef = humanizeMetadataReference(value.trim());
			if (metadataRef) {
				return metadataRef;
			}
			return genericValueLabels[value.trim()] || value;
		}
		if (typeof value === 'boolean') {
			return value ? 'Да' : 'Нет';
		}
		if (typeof value === 'number') {
			return String(value);
		}
		if (Array.isArray(value)) {
			return value.map((item) => toDisplayText(item)).join(', ');
		}
		try {
			return JSON.stringify(value);
		} catch {
			return String(value);
		}
	}

	function humanizeMetadataReference(value) {
		const match = /^([A-Za-z][A-Za-z0-9]*)\.(.+)$/.exec(value);
		if (!match) {
			return '';
		}
		const label = refKindLabels[match[1]];
		if (!label || !match[2]) {
			return '';
		}
		return `${label}: ${match[2]}`;
	}

	function asObject(value) {
		return typeof value === 'object' && value !== null ? value : {};
	}

	function escapeHtml(value) {
		return String(value)
			.replaceAll('&', '&amp;')
			.replaceAll('<', '&lt;')
			.replaceAll('>', '&gt;')
			.replaceAll('"', '&quot;')
			.replaceAll("'", '&#39;');
	}

	if (toggleTechnicalButton) {
		toggleTechnicalButton.addEventListener('click', function () {
			technicalVisible = !technicalVisible;
			renderTechnical();
		});
	}

	renderWarnings();
	renderTabs();
	renderContent();
	renderTechnical();
})();
