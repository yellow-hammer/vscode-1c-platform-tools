import * as assert from 'node:assert';
import {
	GIT_BRANCH_VARIABLE,
	containsGitBranchVariable,
	normalizeBranchDirName,
	parseGitHead,
	branchDirNameFromHead,
	substituteGitBranch,
} from '../../shared/launchVariables';

suite('launchVariables', () => {
	test('containsGitBranchVariable: только точное имя переменной', () => {
		assert.strictEqual(containsGitBranchVariable('/F./build/${gitBranch}'), true);
		assert.strictEqual(containsGitBranchVariable('/F./build/ib'), false);
		assert.strictEqual(containsGitBranchVariable('${gitbranch}'), false);
		assert.strictEqual(containsGitBranchVariable('${workspaceFolder}'), false);
	});

	test('normalizeBranchDirName: слэши и недопустимые символы сворачиваются в дефис', () => {
		assert.strictEqual(normalizeBranchDirName('feature/RS-123'), 'feature-RS-123');
		assert.strictEqual(normalizeBranchDirName('fix/win: paths?'), 'fix-win-paths');
		assert.strictEqual(normalizeBranchDirName('a\\b|c<d>e"f*g'), 'a-b-c-d-e-f-g');
	});

	test('normalizeBranchDirName: регистр, точки, кириллица сохраняются', () => {
		assert.strictEqual(normalizeBranchDirName('Feature/RS-123'), 'Feature-RS-123');
		assert.strictEqual(normalizeBranchDirName('release/8.3.27'), 'release-8.3.27');
		assert.strictEqual(normalizeBranchDirName('фича/отчёты'), 'фича-отчёты');
	});

	test('normalizeBranchDirName: дефисы не повторяются, края очищаются', () => {
		assert.strictEqual(normalizeBranchDirName('feat//x'), 'feat-x');
		assert.strictEqual(normalizeBranchDirName('feat/-x-'), 'feat-x');
		assert.strictEqual(normalizeBranchDirName('.hidden.'), 'hidden');
	});

	test('normalizeBranchDirName: длина ограничена 64 символами', () => {
		const long = 'feature/' + 'a'.repeat(100);
		const name = normalizeBranchDirName(long);
		assert.ok(name.length <= 64, `длина ${name.length}`);
		assert.ok(name.startsWith('feature-a'));
		// после обрезки не остаётся висячих дефисов и точек
		assert.strictEqual(normalizeBranchDirName('a'.repeat(63) + '/-x'), 'a'.repeat(63));
	});

	test('normalizeBranchDirName: пустой результат и зарезервированные имена Windows', () => {
		assert.strictEqual(normalizeBranchDirName('///'), 'branch');
		assert.strictEqual(normalizeBranchDirName(''), 'branch');
		assert.strictEqual(normalizeBranchDirName('nul'), 'git-nul');
		assert.strictEqual(normalizeBranchDirName('CON'), 'git-CON');
		assert.strictEqual(normalizeBranchDirName('com1'), 'git-com1');
		// не зарезервировано — обычные имена не трогаются
		assert.strictEqual(normalizeBranchDirName('console'), 'console');
	});

	test('parseGitHead: символическая ссылка на ветку', () => {
		assert.deepStrictEqual(parseGitHead('ref: refs/heads/main\n'), { branch: 'main' });
		assert.deepStrictEqual(parseGitHead('ref: refs/heads/feature/RS-123'), { branch: 'feature/RS-123' });
	});

	test('parseGitHead: отсоединённый HEAD — хэш коммита', () => {
		const sha = 'a1b2c3d4e5f60718293a4b5c6d7e8f9012345678';
		assert.deepStrictEqual(parseGitHead(`${sha}\n`), { sha });
		// SHA-256-репозитории тоже распознаются
		assert.deepStrictEqual(parseGitHead('A'.repeat(64)), { sha: 'a'.repeat(64) });
	});

	test('parseGitHead: мусор не распознаётся', () => {
		assert.strictEqual(parseGitHead(''), undefined);
		assert.strictEqual(parseGitHead('ref:'), undefined);
		assert.strictEqual(parseGitHead('что-то другое'), undefined);
		assert.strictEqual(parseGitHead('a1b2'), undefined);
	});

	test('branchDirNameFromHead: ветка нормализуется, отсоединённый HEAD — 8 символов хэша', () => {
		assert.strictEqual(branchDirNameFromHead({ branch: 'feature/RS-123' }), 'feature-RS-123');
		assert.strictEqual(
			branchDirNameFromHead({ sha: 'a1b2c3d4e5f60718293a4b5c6d7e8f9012345678' }),
			'a1b2c3d4'
		);
		assert.strictEqual(branchDirNameFromHead(undefined), undefined);
		assert.strictEqual(branchDirNameFromHead({}), undefined);
	});

	test('substituteGitBranch: подставляются все вхождения, чужие ${…} не трогаются', () => {
		assert.strictEqual(
			substituteGitBranch('/F./build/${gitBranch}', 'feature-RS-123'),
			'/F./build/feature-RS-123'
		);
		assert.strictEqual(
			substituteGitBranch('${gitBranch}/${gitBranch}', 'x'),
			'x/x'
		);
		assert.strictEqual(
			substituteGitBranch('${workspaceFolder}/${gitBranch}', 'x'),
			'${workspaceFolder}/x'
		);
		assert.strictEqual(substituteGitBranch('без переменных', 'x'), 'без переменных');
	});

	test('GIT_BRANCH_VARIABLE — документированное имя переменной', () => {
		assert.strictEqual(GIT_BRANCH_VARIABLE, '${gitBranch}');
	});
});
