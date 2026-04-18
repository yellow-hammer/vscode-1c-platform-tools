(function () {
	const vscode = acquireVsCodeApi();
	const initial = window.__INITIAL_DATA__ || {};
	const sourceKind = window.__SOURCE_KIND__ || '';
	const statusEl = document.getElementById('status');

	const selects = {
		defaultRunMode: ['MANAGED_APPLICATION', 'ORDINARY_APPLICATION'],
		scriptVariant: ['RUSSIAN', 'ENGLISH'],
		dataLockControlMode: ['AUTOMATIC', 'MANAGED', 'AUTOMATIC_AND_MANAGED'],
		objectAutonumerationMode: ['AUTO_FREE', 'NOT_AUTO_FREE'],
		modalityUseMode: ['USE', 'USE_WITH_WARNINGS', 'DONT_USE'],
		synchronousPlatformExtensionAndAddInCallUseMode: ['USE', 'USE_WITH_WARNINGS', 'DONT_USE'],
		interfaceCompatibilityMode: ['TAXI', 'TAXI_ENABLE_VERSION_8_2', 'VERSION_8_2_ENABLE_TAXI', 'VERSION_8_2'],
		compatibilityMode: [
			'DONT_USE', 'VERSION_8_3_27', 'VERSION_8_3_26', 'VERSION_8_3_25', 'VERSION_8_3_24',
			'VERSION_8_3_23', 'VERSION_8_3_22', 'VERSION_8_3_21', 'VERSION_8_3_20', 'VERSION_8_3_19',
			'VERSION_8_3_18', 'VERSION_8_3_17', 'VERSION_8_3_16', 'VERSION_8_3_15', 'VERSION_8_3_14',
			'VERSION_8_3_13', 'VERSION_8_3_12', 'VERSION_8_3_11', 'VERSION_8_3_10', 'VERSION_8_3_9',
			'VERSION_8_3_8', 'VERSION_8_3_7', 'VERSION_8_3_6', 'VERSION_8_3_5', 'VERSION_8_3_4',
			'VERSION_8_3_3', 'VERSION_8_3_2', 'VERSION_8_3_1', 'VERSION_8_2_16', 'VERSION_8_2_13', 'VERSION_8_1'
		]
	};

	function initSelect(id, values, selected) {
		const el = document.getElementById(id);
		for (const v of values) {
			const opt = document.createElement('option');
			opt.value = v;
			opt.textContent = v;
			el.appendChild(opt);
		}
		el.value = selected && values.includes(selected) ? selected : (values[0] || '');
	}

	function setValue(id, value) {
		const el = document.getElementById(id);
		if (!el) {
			return;
		}
		el.value = value || '';
	}

	function splitCsv(value) {
		return (value || '')
			.split(',')
			.map((v) => v.trim())
			.filter((v) => v.length > 0);
	}

	function collect() {
		return {
			name: document.getElementById('name').value.trim(),
			synonymRu: document.getElementById('synonymRu').value,
			comment: document.getElementById('comment').value,
			defaultRunMode: document.getElementById('defaultRunMode').value,
			usePurposes: splitCsv(document.getElementById('usePurposes').value),
			scriptVariant: document.getElementById('scriptVariant').value,
			defaultRoles: splitCsv(document.getElementById('defaultRoles').value),
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
		setValue('usePurposes', (dto.usePurposes || []).join(', '));
		setValue('defaultRoles', (dto.defaultRoles || []).join(', '));
		setValue('briefInformationRu', dto.briefInformationRu);
		setValue('detailedInformationRu', dto.detailedInformationRu);
		setValue('copyrightRu', dto.copyrightRu);
		setValue('vendorInformationAddressRu', dto.vendorInformationAddressRu);
		setValue('configurationInformationAddressRu', dto.configurationInformationAddressRu);
		setValue('vendor', dto.vendor);
		setValue('version', dto.version);
		setValue('updateCatalogAddress', dto.updateCatalogAddress);

		initSelect('defaultRunMode', selects.defaultRunMode, dto.defaultRunMode);
		initSelect('scriptVariant', selects.scriptVariant, dto.scriptVariant);
		initSelect('dataLockControlMode', selects.dataLockControlMode, dto.dataLockControlMode);
		initSelect('objectAutonumerationMode', selects.objectAutonumerationMode, dto.objectAutonumerationMode);
		initSelect('modalityUseMode', selects.modalityUseMode, dto.modalityUseMode);
		initSelect(
			'synchronousPlatformExtensionAndAddInCallUseMode',
			selects.synchronousPlatformExtensionAndAddInCallUseMode,
			dto.synchronousPlatformExtensionAndAddInCallUseMode
		);
		initSelect('interfaceCompatibilityMode', selects.interfaceCompatibilityMode, dto.interfaceCompatibilityMode);
		initSelect('compatibilityMode', selects.compatibilityMode, dto.compatibilityMode);
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

	window.addEventListener('message', (event) => {
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

	if (sourceKind === 'externalErf' || sourceKind === 'externalEpf') {
		const modulesSection = document.getElementById('modulesSection');
		if (modulesSection) {
			modulesSection.classList.add('hidden');
		}
	}
})();
