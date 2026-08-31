import * as assert from 'node:assert';
import { isCommandExposedToMcp, commandSupportsWait } from '../../shared/mcpCommandPolicy';

suite('mcpCommandPolicy', () => {
	test('чужие команды VS Code агенту не публикуются', () => {
		assert.strictEqual(isCommandExposedToMcp('workbench.action.files.save'), false);
		assert.strictEqual(isCommandExposedToMcp('1c-platform-tools.debug.connectTarget'), false);
	});

	test('рабочие команды публикуются', () => {
		for (const id of [
			'1c-platform-tools.cf.load',
			'1c-platform-tools.infobase.updateDb',
			'1c-platform-tools.test.runXUnit',
			'1c-platform-tools.env.status',
			'1c-platform-tools.epf.run',
		]) {
			assert.strictEqual(isCommandExposedToMcp(id), true, id);
		}
	});

	test('запуск платформы возвращает исход старта: шаг пайплайна знает, получилось ли', () => {
		for (const id of ['1c-platform-tools.run.designer', '1c-platform-tools.run.enterprise']) {
			assert.strictEqual(commandSupportsWait(id), true, id);
		}
	});

	test('интерактивные мастера и навигация скрыты', () => {
		for (const id of [
			'1c-platform-tools.help.openCreateIssue',
			'1c-platform-tools.help.copyEnvironmentSummary',
			'1c-platform-tools.help.openGetStarted',
			'1c-platform-tools.tools.openSettings',
			'1c-platform-tools.tools.refresh',
			'1c-platform-tools.mcp.configureCursor',
			'1c-platform-tools.metadata.openViewer',
			'1c-platform-tools.env.createProfile',
			'1c-platform-tools.env.setOverrides',
			'1c-platform-tools.projects.create',
			'1c-platform-tools.infobaseList.open',
			'1c-platform-tools.infobaseList.launchEnterprise',
		]) {
			assert.strictEqual(isCommandExposedToMcp(id), false, id);
		}
	});

	test('команды vanessa-runner возвращают исход операции', () => {
		for (const id of [
			'1c-platform-tools.cf.load',
			'1c-platform-tools.infobase.updateDb',
			'1c-platform-tools.syntaxCheck.run',
			'1c-platform-tools.cfe.compile',
			'1c-platform-tools.env.selectProfile',
			'1c-platform-tools.env.clearOverrides',
			'1c-platform-tools.test.configure',
		]) {
			assert.strictEqual(commandSupportsWait(id), true, id);
		}
	});

	test('команды без синхронного результата помечены', () => {
		for (const id of [
			'1c-platform-tools.server.start',
			'1c-platform-tools.debug.measure.start',
			'1c-platform-tools.dependencies.install',
			'1c-platform-tools.syntaxCheck.refresh',
			'1c-platform-tools.tasks.run',
			'1c-platform-tools.tasks.runOscript',
			'1c-platform-tools.components.update',
		]) {
			assert.strictEqual(commandSupportsWait(id), false, id);
		}
	});

	test('обновление компонентов агенту не отдаётся: список выбирают галочками', () => {
		assert.strictEqual(isCommandExposedToMcp('1c-platform-tools.components.update'), false);
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

suite('mcpCommandPolicy: сборка и разбор', () => {
	test('доступна одна команда на действие, в домене объекта', () => {
		for (const id of [
			'1c-platform-tools.cf.compile',
			'1c-platform-tools.cf.decompile',
			'1c-platform-tools.cfe.compile',
			'1c-platform-tools.cfe.decompile',
			'1c-platform-tools.epf.compileProcessor',
			'1c-platform-tools.epf.decompileProcessor',
			'1c-platform-tools.epf.compileReport',
			'1c-platform-tools.epf.decompileReport',
		]) {
			assert.strictEqual(isCommandExposedToMcp(id), true, id);
		}
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

suite('mcpCommandPolicy: сеансы информационной базы', () => {
	test('команды сеансов доступны агенту и возвращают исход', () => {
		for (const id of [
			'1c-platform-tools.session.lock',
			'1c-platform-tools.session.unlock',
			'1c-platform-tools.session.kill',
			'1c-platform-tools.session.checkClosed',
		]) {
			assert.strictEqual(isCommandExposedToMcp(id), true, id);
			assert.strictEqual(commandSupportsWait(id), true, id);
		}
	});
});

suite('mcpCommandPolicy: регламентные задания', () => {
	test('команды заданий доступны агенту и возвращают исход', () => {
		for (const id of ['1c-platform-tools.session.lockJobs', '1c-platform-tools.session.unlockJobs']) {
			assert.strictEqual(isCommandExposedToMcp(id), true, id);
			assert.strictEqual(commandSupportsWait(id), true, id);
		}
	});
});

suite('mcpCommandPolicy: пайплайны', () => {
	test('запуск цепочки доступен агенту и возвращает исход', () => {
		assert.strictEqual(isCommandExposedToMcp('1c-platform-tools.pipelines.run'), true);
		assert.strictEqual(commandSupportsWait('1c-platform-tools.pipelines.run'), true);
	});

	test('конструкторы агенту не публикуются: файлы он правит напрямую', () => {
		for (const id of [
			'1c-platform-tools.pipelines.openEditor',
			'1c-platform-tools.hooks.openEditor',
		]) {
			assert.strictEqual(isCommandExposedToMcp(id), false, id);
		}
	});
});
