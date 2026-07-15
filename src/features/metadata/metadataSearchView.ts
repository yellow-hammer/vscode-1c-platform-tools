/**
 * Поле поиска над деревом метаданных: отдельный webview-view, потому что у TreeView
 * своего поля ввода нет.
 * @module metadataSearchView
 */
import * as vscode from 'vscode';

export const METADATA_SEARCH_VIEW_ID = '1c-platform-tools-metadata-search';

/** Задержка перед перестроением дерева: дерево не дёргается на каждый символ. */
const INPUT_DEBOUNCE_MS = 250;

export class MetadataSearchViewProvider implements vscode.WebviewViewProvider {
	private _view: vscode.WebviewView | undefined;

	constructor(
		private readonly _extensionUri: vscode.Uri,
		private readonly _onQueryChanged: (query: string) => void
	) {}

	resolveWebviewView(view: vscode.WebviewView): void {
		this._view = view;
		view.webview.options = { enableScripts: true, localResourceRoots: [this._extensionUri] };
		view.webview.html = this.html();
		view.webview.onDidReceiveMessage((msg: unknown) => {
			if (typeof msg === 'object' && msg !== null && (msg as { type?: string }).type === 'search') {
				const query = (msg as { query?: unknown }).query;
				this._onQueryChanged(typeof query === 'string' ? query : '');
			}
		});
		view.onDidDispose(() => {
			this._view = undefined;
		});
	}

	/** Сбрасывает поле извне (например, командой очистки). */
	clear(): void {
		this._view?.webview.postMessage({ type: 'clear' });
		this._onQueryChanged('');
	}

	/** Показывает в поле запрос, введённый другим способом: поле и кнопка-лупа ищут одно и то же. */
	showQuery(query: string): void {
		this._view?.webview.postMessage({ type: 'setQuery', query });
	}

	private html(): string {
		return `<!DOCTYPE html>
<html lang="ru">
<head>
<meta charset="UTF-8" />
<style>
	/* Секция занимает минимум места: только строка ввода. */
	body {
		margin: 0;
		padding: 2px 8px 3px 8px;
		font-family: var(--vscode-font-family);
		font-size: var(--vscode-font-size);
		overflow: hidden;
	}
	.wrap {
		position: relative;
		display: block;
	}
	input {
		width: 100%;
		box-sizing: border-box;
		padding: 3px 22px 3px 6px;
		border-radius: 2px;
		border: 1px solid var(--vscode-input-border, transparent);
		background: var(--vscode-input-background);
		color: var(--vscode-input-foreground);
		font-family: inherit;
		font-size: inherit;
	}
	input:focus {
		outline: 1px solid var(--vscode-focusBorder);
		outline-offset: -1px;
	}
	input::placeholder {
		color: var(--vscode-input-placeholderForeground);
	}
	.clear {
		position: absolute;
		top: 50%;
		right: 4px;
		transform: translateY(-50%);
		border: none;
		background: transparent;
		color: var(--vscode-descriptionForeground);
		cursor: pointer;
		padding: 0 2px;
		font-size: 13px;
		line-height: 1;
	}
	.clear:hover {
		color: var(--vscode-foreground);
	}
	.clear.hidden {
		display: none;
	}
</style>
</head>
<body>
	<label class="wrap">
		<input id="q" type="text" placeholder="Поиск по метаданным…" autocomplete="off" />
		<button id="clear" class="clear hidden" type="button" title="Очистить">×</button>
	</label>
	<script>
		const vscodeApi = acquireVsCodeApi();
		const input = document.getElementById('q');
		const clearBtn = document.getElementById('clear');
		let timer;
		function send() {
			clearBtn.classList.toggle('hidden', input.value.length === 0);
			clearTimeout(timer);
			timer = setTimeout(function () {
				vscodeApi.postMessage({ type: 'search', query: input.value });
			}, ${INPUT_DEBOUNCE_MS});
		}
		input.addEventListener('input', send);
		input.addEventListener('keydown', function (e) {
			if (e.key === 'Escape' && input.value.length > 0) {
				input.value = '';
				send();
			}
		});
		clearBtn.addEventListener('click', function () {
			input.value = '';
			input.focus();
			send();
		});
		window.addEventListener('message', function (event) {
			if (!event.data) {
				return;
			}
			if (event.data.type === 'clear') {
				input.value = '';
				clearBtn.classList.add('hidden');
			}
			if (event.data.type === 'setQuery') {
				input.value = event.data.query || '';
				clearBtn.classList.toggle('hidden', input.value.length === 0);
			}
		});
	</script>
</body>
</html>`;
	}
}
