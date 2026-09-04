import * as assert from 'node:assert';
import {
	formatComponentLine,
	formatEnvironmentSummary,
	formatToolLine,
	type EnvironmentSummary,
} from '../../shared/environmentSummary';

function sampleSummary(overrides: Partial<EnvironmentSummary> = {}): EnvironmentSummary {
	return {
		os: 'Windows_NT 10.0.26200',
		arch: 'x64',
		editor: 'Cursor',
		editorVersion: '1.2.3',
		extensionVersion: '0.8.9',
		mcpVersion: '0.2.0',
		nodeVersion: '20.11.0',
		oscript: { path: 'C:/ovm/current/bin/oscript.exe', version: '2.0.0' },
		vrunner: { path: 'oscript_modules/bin/vrunner.bat', version: '3.0.0' },
		components: [
			{
				title: 'Отладчик 1С (onec-debug-adapter)',
				version: 'v1.4.0',
				cachePath: 'C:/storage/onec-debug-adapter',
				autoloadOff: false,
			},
			{
				title: 'Дерево метаданных (md-sparrow)',
				autoloadOff: true,
			},
		],
		platformVersions: ['8.3.27.1936', '8.3.24.1548'],
		racPath: 'C:/Program Files/1cv8/8.3.27.1936/bin/rac.exe',
		edtVersions: ['2026.1'],
		edtCliPath: 'C:/1C/1cedtstart/installations/1C_EDT 2026.1/1cedt/1cedtcli.exe',
		ipcEnabled: true,
		ipcPort: 40241,
		ipcTokenSet: true,
		...overrides,
	};
}

suite('сводка окружения', () => {
	test('инструмент без пути и версии — не найден', () => {
		assert.strictEqual(formatToolLine('OneScript', {}), '- OneScript: не найден');
	});

	test('компонент без кэша — не загружен', () => {
		assert.strictEqual(
			formatComponentLine({ title: 'OVM', autoloadOff: false }),
			'OVM: не загружен'
		);
	});

	test('сводка содержит обязательные поля и не содержит значение токена', () => {
		const text = formatEnvironmentSummary(sampleSummary());
		assert.match(text, /^## Окружение\n/);
		assert.match(text, /- ОС: Windows_NT 10\.0\.26200 \(x64\)/);
		assert.match(text, /- Редактор: Cursor 1\.2\.3/);
		assert.match(text, /- Расширение: 0\.8\.9/);
		assert.match(text, /- MCP: 0\.2\.0/);
		assert.match(text, /- OneScript: 2\.0\.0, C:\/ovm\/current\/bin\/oscript\.exe/);
		assert.match(text, /- Платформа 1С: 8\.3\.27\.1936, 8\.3\.24\.1548/);
		assert.match(text, /- rac: C:\/Program Files\/1cv8\/8\.3\.27\.1936\/bin\/rac\.exe/);
		assert.match(text, /- IPC: включён, порт 40241, токен задан/);
		assert.doesNotMatch(text, /неизвестно/);
		assert.doesNotMatch(text, /secret|password|пароль/i);
	});

	test('отсутствующие части пишутся явно', () => {
		const text = formatEnvironmentSummary(
			sampleSummary({
				mcpVersion: undefined,
				oscript: {},
				vrunner: {},
				components: [],
				platformVersions: [],
				racPath: undefined,
				ipcEnabled: false,
				ipcTokenSet: false,
				workspaceTrusted: false,
				remoteName: 'ssh-remote',
			})
		);
		assert.match(text, /- MCP: не установлено/);
		assert.match(text, /- OneScript: не найден/);
		assert.match(text, /- vrunner: не найден/);
		assert.match(text, /- Компоненты:\n  - нет/);
		assert.match(text, /- Платформа 1С: не найдена/);
		assert.match(text, /- rac: не найден/);
		assert.match(text, /- IPC: выключен, порт 40241, токен не задан/);
		assert.match(text, /- Удалённый режим: ssh-remote/);
		assert.match(text, /- Рабочая область: ограниченная/);
	});
});
