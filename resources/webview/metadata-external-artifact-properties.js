(function () {
	const vscode = acquireVsCodeApi();
	const initial = window.__INITIAL_DATA__ || {};
	const status = document.getElementById('status');
	const title = document.getElementById('title');

	function setValue(id, value) {
		const el = document.getElementById(id);
		if (el) {
			el.value = value || '';
		}
	}

	function fill(dto) {
		setValue('name', dto.name);
		setValue('synonymRu', dto.synonymRu);
		setValue('comment', dto.comment);
		title.textContent =
			dto.kind === 'DATA_PROCESSOR' ? 'Свойства внешней обработки' : 'Свойства внешнего отчёта';
	}

	function collect() {
		return {
			kind: initial.kind || 'REPORT',
			name: document.getElementById('name').value.trim(),
			synonymRu: document.getElementById('synonymRu').value,
			comment: document.getElementById('comment').value
		};
	}

	document.getElementById('saveBtn').addEventListener('click', () => {
		status.textContent = 'Сохраняем...';
		vscode.postMessage({ type: 'save', payload: collect() });
	});

	window.addEventListener('message', (event) => {
		const msg = event.data;
		if (!msg || msg.type !== 'saved') {
			return;
		}
		status.textContent = msg.ok ? 'Сохранено' : 'Ошибка сохранения';
	});

	fill(initial);
})();
