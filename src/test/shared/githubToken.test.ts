import * as assert from 'node:assert';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { isGithubRateLimit } from '../../shared/githubToken';
import { isCommandExposedToMcp } from '../../shared/mcpCommandPolicy';

const EXTENSION_ROOT = path.resolve(__dirname, '../../..');

const SET_TOKEN = '1c-platform-tools.components.setGithubToken';
const FORGET_TOKEN = '1c-platform-tools.components.forgetGithubToken';

suite('токен GitHub', () => {
	test('лимит анонимных запросов распознаётся по ответу GitHub', () => {
		const real = 'GitHub API 403: {"message":"API rate limit exceeded for 91.212.179.231. '
			+ '(But here\'s the good news: Authenticated requests get a higher rate limit.)"}';
		assert.strictEqual(isGithubRateLimit(real), true);
	});

	test('другие отказы за лимит не выдаются', () => {
		assert.strictEqual(isGithubRateLimit('GitHub API 404: Not Found'), false);
		assert.strictEqual(isGithubRateLimit('GitHub API 403: Forbidden'), false);
		assert.strictEqual(isGithubRateLimit('ENOTFOUND api.github.com'), false);
	});

	test('команды токена объявлены в package.json', () => {
		const pkg = JSON.parse(fs.readFileSync(path.join(EXTENSION_ROOT, 'package.json'), 'utf8')) as {
			contributes: { commands: { command: string; title: string }[] };
		};
		const declared = new Map(pkg.contributes.commands.map((item) => [item.command, item.title]));
		assert.strictEqual(declared.get(SET_TOKEN), 'Указать токен GitHub');
		assert.strictEqual(declared.get(FORGET_TOKEN), 'Забыть токен GitHub');
	});

	test('агенту команды токена не отдаются: секрет вводит человек', () => {
		assert.strictEqual(isCommandExposedToMcp(SET_TOKEN), false);
		assert.strictEqual(isCommandExposedToMcp(FORGET_TOKEN), false);
	});

	test('заданное вручную идёт перед сессией GitHub', () => {
		const source = fs.readFileSync(path.join(EXTENSION_ROOT, 'src', 'shared', 'githubReleaseLoader.ts'), 'utf8');
		const order = [
			'githubTokenFromStore()',
			'PLATFORM_TOOLS_GITHUB_TOKEN',
			'PLATFORM_TOOLS_MD_SPARROW_GITHUB_TOKEN',
			'githubTokenFromSession()',
		].map((needle) => source.indexOf(needle, source.indexOf('const candidates = [')));
		assert.ok(order.every((index) => index > 0), 'кандидаты токена не найдены');
		assert.deepStrictEqual(
			[...order].sort((a, b) => a - b),
			order,
			'порядок: сохранённый токен, переменные окружения, сессия редактора'
		);
	});

	test('сессия запрашивается без прав: релизы публичные', () => {
		const source = fs.readFileSync(path.join(EXTENSION_ROOT, 'src', 'shared', 'githubToken.ts'), 'utf8');
		assert.ok(source.includes("getSession('github', []"), 'у сессии не должно быть запрошенных scope');
	});

	test('на активации сессия читается молча, без окна входа', () => {
		const source = fs.readFileSync(path.join(EXTENSION_ROOT, 'src', 'shared', 'githubToken.ts'), 'utf8');
		assert.ok(source.includes('readGithubSession(true)'), 'при инициализации вход предлагать нельзя');
	});
});
