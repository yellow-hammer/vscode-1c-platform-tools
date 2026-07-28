import * as assert from 'node:assert';
import { isCommandExposedToMcp, commandSupportsWait } from '../../shared/mcpCommandPolicy';

suite('mcpCommandPolicy', () => {
	test('чужие команды VS Code агенту не публикуются', () => {
		assert.strictEqual(isCommandExposedToMcp('workbench.action.files.save'), false);
		assert.strictEqual(isCommandExposedToMcp('debug.debugTargets.connect'), false);
	});

	test('рабочие команды публикуются', () => {
		for (const id of [
			'1c-platform-tools.configuration.loadFromSrc',
			'1c-platform-tools.test.runXUnit',
			'1c-platform-tools.env.status',
			'1c-platform-tools.enterprise.run',
		]) {
			assert.strictEqual(isCommandExposedToMcp(id), true, id);
		}
	});

	test('интерактивные мастера и навигация скрыты', () => {
		for (const id of [
			'1c-platform-tools.help.openCreateIssue',
			'1c-platform-tools.getStarted.open',
			'1c-platform-tools.settings',
			'1c-platform-tools.refresh',
			'1c-platform-tools.mcp.configureCursor',
			'1c-platform-tools.metadata.openViewer',
			'1c-platform-tools.env.createProfile',
			'1c-platform-tools.env.setOverrides',
			'1c-platform-tools.project.createFromWelcome',
		]) {
			assert.strictEqual(isCommandExposedToMcp(id), false, id);
		}
	});

	test('команды vanessa-runner возвращают исход операции', () => {
		for (const id of [
			'1c-platform-tools.configuration.loadFromSrc',
			'1c-platform-tools.test.syntaxCheck',
			'1c-platform-tools.extensions.build',
			'1c-platform-tools.env.selectProfile',
			'1c-platform-tools.env.clearOverrides',
			'1c-platform-tools.testing.configure',
		]) {
			assert.strictEqual(commandSupportsWait(id), true, id);
		}
	});

	test('команды без синхронного результата помечены', () => {
		for (const id of [
			'1c-platform-tools.run.designer',
			'1c-platform-tools.server.start',
			'1c-platform-tools.debug.measure.start',
			'1c-platform-tools.dependencies.install',
			'1c-platform-tools.syntaxCheck.refreshDiagnostics',
			'1c-platform-tools.launch.run',
			'1c-platform-tools.oscript.run',
			'1c-platform-tools.components.update',
		]) {
			assert.strictEqual(commandSupportsWait(id), false, id);
		}
	});

	test('скрытые команды и признак синхронности не конфликтуют', () => {
		// Скрытая команда до агента не доходит, поэтому её признак роли не играет,
		// но опубликованная команда обязана иметь осмысленный признак
		assert.strictEqual(isCommandExposedToMcp('1c-platform-tools.server.menu'), false);
		assert.strictEqual(isCommandExposedToMcp('1c-platform-tools.server.start'), true);
		assert.strictEqual(commandSupportsWait('1c-platform-tools.server.start'), false);
	});
});

suite('mcpCommandPolicy: служебные команды VS Code', () => {
	test('команды контейнера представлений не публикуются', () => {
		assert.strictEqual(isCommandExposedToMcp('1c-platform-tools.open'), false);
		assert.strictEqual(isCommandExposedToMcp('1c-platform-tools.resetViewLocation'), false);
	});

	test('похожие рабочие команды не задеты', () => {
		assert.strictEqual(isCommandExposedToMcp('1c-platform-tools.server.openInBrowser'), true);
		assert.strictEqual(isCommandExposedToMcp('1c-platform-tools.openConfiguration'), true);
	});
});

suite('mcpCommandPolicy: синонимы команд', () => {
	test('из пары синонимов агенту доступно одно имя', () => {
		// build.configuration и configuration.build вызывают один обработчик
		assert.strictEqual(isCommandExposedToMcp('1c-platform-tools.configuration.build'), true);
		assert.strictEqual(isCommandExposedToMcp('1c-platform-tools.build.configuration'), false);

		assert.strictEqual(isCommandExposedToMcp('1c-platform-tools.extensions.decompile'), true);
		assert.strictEqual(isCommandExposedToMcp('1c-platform-tools.decompile.extension'), false);

		assert.strictEqual(isCommandExposedToMcp('1c-platform-tools.externalProcessors.build'), true);
		assert.strictEqual(isCommandExposedToMcp('1c-platform-tools.build.externalProcessor'), false);

		assert.strictEqual(isCommandExposedToMcp('1c-platform-tools.externalReports.decompile'), true);
		assert.strictEqual(isCommandExposedToMcp('1c-platform-tools.decompile.externalReport'), false);
	});
});

suite('mcpCommandPolicy: служебные команды представлений', () => {
	test('команды, которые заводит сам VS Code, скрыты', () => {
		for (const id of [
			'1c-platform-tools.open',
			'1c-platform-tools.removeView',
			'1c-platform-tools.toggleVisibility',
			'1c-platform-tools.resetViewLocation',
			'1c-platform-tools.resetViewContainerLocation',
		]) {
			assert.strictEqual(isCommandExposedToMcp(id), false, id);
		}
	});

	test('внутренние команды расширения скрыты', () => {
		assert.strictEqual(isCommandExposedToMcp('1c-platform-tools.serviceFiles.ensure'), false);
		assert.strictEqual(isCommandExposedToMcp('1c-platform-tools.server.statusBarRefresh'), false);
		// создание служебных файлов по конкретному виду агенту доступно
		assert.strictEqual(isCommandExposedToMcp('1c-platform-tools.serviceFiles.createEnvJson'), true);
	});
});
