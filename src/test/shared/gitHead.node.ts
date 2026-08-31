/**
 * Чтение имени ветки по .git/HEAD: обычный каталог, worktree, вне репозитория.
 * Запуск: npm run test:node
 */
import { describe, test, after } from 'node:test';
import assert from 'node:assert/strict';
import * as path from 'node:path';
import * as fs from 'node:fs';
import * as os from 'node:os';
import { readGitBranchDirName } from '../../shared/gitHead';

const roots: string[] = [];

function makeRoot(): string {
	const root = fs.mkdtempSync(path.join(os.tmpdir(), 'gitHead-test-'));
	roots.push(root);
	return root;
}

after(() => {
	for (const root of roots) {
		fs.rmSync(root, { recursive: true, force: true });
	}
});

describe('readGitBranchDirName', () => {
	test('обычный каталог .git: имя ветки нормализуется', () => {
		const root = makeRoot();
		fs.mkdirSync(path.join(root, '.git'));
		fs.writeFileSync(path.join(root, '.git', 'HEAD'), 'ref: refs/heads/feature/RS-123\n');
		assert.equal(readGitBranchDirName(root), 'feature-RS-123');
	});

	test('отсоединённый HEAD: первые 8 символов хэша', () => {
		const root = makeRoot();
		fs.mkdirSync(path.join(root, '.git'));
		fs.writeFileSync(path.join(root, '.git', 'HEAD'), 'a1b2c3d4e5f60718293a4b5c6d7e8f9012345678\n');
		assert.equal(readGitBranchDirName(root), 'a1b2c3d4');
	});

	test('worktree: .git — файл со ссылкой gitdir', () => {
		const root = makeRoot();
		const gitData = path.join(root, 'repo-data', 'worktrees', 'wt1');
		fs.mkdirSync(gitData, { recursive: true });
		fs.writeFileSync(path.join(gitData, 'HEAD'), 'ref: refs/heads/hotfix/x\n');
		fs.writeFileSync(path.join(root, '.git'), `gitdir: ${gitData}\n`);
		assert.equal(readGitBranchDirName(root), 'hotfix-x');
	});

	test('относительный gitdir достраивается от корня', () => {
		const root = makeRoot();
		const gitData = path.join(root, '.real-git');
		fs.mkdirSync(gitData);
		fs.writeFileSync(path.join(gitData, 'HEAD'), 'ref: refs/heads/main\n');
		fs.writeFileSync(path.join(root, '.git'), 'gitdir: .real-git\n');
		assert.equal(readGitBranchDirName(root), 'main');
	});

	test('вне репозитория и при мусорном HEAD — undefined', () => {
		const noRepo = makeRoot();
		assert.equal(readGitBranchDirName(noRepo), undefined);

		const broken = makeRoot();
		fs.mkdirSync(path.join(broken, '.git'));
		fs.writeFileSync(path.join(broken, '.git', 'HEAD'), 'мусор');
		assert.equal(readGitBranchDirName(broken), undefined);

		const noHead = makeRoot();
		fs.mkdirSync(path.join(noHead, '.git'));
		assert.equal(readGitBranchDirName(noHead), undefined);
	});
});
