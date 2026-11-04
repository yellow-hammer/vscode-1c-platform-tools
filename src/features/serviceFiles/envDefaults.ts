import { VRUNNER_SCHEMA, HOOKS_SCHEMA, PIPELINES_SCHEMA } from './schemaUrls';

/** Ключи клиента: показ всех функций и русский интерфейс. */
const LAUNCH_ADDITIONAL = '/DisplayAllFunctions /L ru';

/** Прогон тестов: ключи клиента плюс тихий старт без регламентных заданий. */
export const TEST_ADDITIONAL =
	`${LAUNCH_ADDITIONAL} /DisableStartupDialogs /DisableStartupMessages /AllowExecuteScheduledJobs -Off`;

/** Версия платформы новых служебных файлов: та, что пишет самый свежий формат выгрузки. */
export const DEFAULT_PLATFORM = '8.5';

/** Базовые поля секции default, общие для всех env-файлов */
const DEFAULT_SECTION = {
	'--ibconnection': '/F./build/ib',
	'--db-user': '',
	'--db-pwd': '',
	'--root': '.',
	'--workspace': '.',
	'--v8version': DEFAULT_PLATFORM,
	'--locale': 'ru',
	'--language': 'ru',
};

/** Канонический дефолт env.json */
export const ENV_DEFAULTS = {
	$schema: VRUNNER_SCHEMA,
	default: {
		...DEFAULT_SECTION,
		'--additional': LAUNCH_ADDITIONAL,
		'--ordinaryapp': '-1',
	},
};

/**
 * Канонический дефолт autumn-properties.json (формат vanessa-runner 3.0).
 *
 * Рукописный v3-шаблон (не конвертация env.json): каскад `vrunner.<команда>.<опция>`,
 * глобальные опции на `vrunner.<опция>`. Перенос с 2.x — зона vanessa-runner, не расширения.
 */
export const AUTUMN_DEFAULTS = {
	vrunner: {
		ibconnection: '/F./build/ib',
		'db-user': '',
		'db-pwd': '',
		root: '.',
		workspace: '.',
		v8version: DEFAULT_PLATFORM,
		locale: 'ru',
		language: 'ru',
		additional: LAUNCH_ADDITIONAL,
		ordinaryapp: '-1',
	},
};

/** Канонический дефолт tools/vrunner.json */
export const VRUNNER_DEFAULTS = {
	$schema: VRUNNER_SCHEMA,
	default: {
		...DEFAULT_SECTION,
		'--ordinaryapp': '0',
	},
	vanessa: {
		'--vanessasettings': './tools/VAParams.json',
		'--pathvanessa': './oscript_modules/vanessa-automation-single/vanessa-automation-single.epf',
		'--additional': TEST_ADDITIONAL,
	},
};

/** Канонический дефолт tools/vrunner.init.json */
export const VRUNNER_INIT_DEFAULTS = {
	$schema: VRUNNER_SCHEMA,
	default: {
		...DEFAULT_SECTION,
		'--ordinaryapp': '0',
	},
	vanessa: {
		'--vanessasettings': './tools/VAParams.init.json',
		'--pathvanessa': './oscript_modules/vanessa-automation-single/vanessa-automation-single.epf',
		'--additional': TEST_ADDITIONAL,
	},
};

/** Пинованная обработка Vanessa (проектный single-файл) для CI-прогонов. */
const CI_BDDRUNNER_PATH = './oscript_modules/vanessa-automation-single/vanessa-automation-single.epf';

/**
 * Файл схемы 3 накладывается на autumn-properties.json, поэтому общая секция
 * профиля (база, пользователь, язык) в него не пишется. Остаётся секция Vanessa.
 */
export const VRUNNER_DEFAULTS_V3 = {
	vrunner: {
		test: {
			vanessa: {
				vanessasettings: './tools/VAParams.json',
				'bddrunner-path': CI_BDDRUNNER_PATH,
				additional: TEST_ADDITIONAL,
			},
		},
	},
};

/** Канонический дефолт tools/vrunner.init.json (формат vanessa-runner 3.0) */
export const VRUNNER_INIT_DEFAULTS_V3 = {
	vrunner: {
		test: {
			vanessa: {
				vanessasettings: './tools/VAParams.init.json',
				'bddrunner-path': CI_BDDRUNNER_PATH,
				additional: TEST_ADDITIONAL,
			},
		},
	},
};

/**
 * Новый файл vrunner с идентификатором в середине имени.
 * На схеме 2 в нём есть секция default: такой файл подменяет env.json.
 * На схеме 3 остаётся только секция Vanessa, база берётся из профиля.
 */
export function vrunnerVariantDocument(schema: 'v2' | 'v3', id: string): Record<string, unknown> {
	const va = `./tools/VAParams.${id}.json`;
	if (schema === 'v2') {
		return {
			...VRUNNER_DEFAULTS,
			vanessa: {
				...VRUNNER_DEFAULTS.vanessa,
				'--vanessasettings': va,
			},
		};
	}
	return {
		vrunner: {
			test: {
				vanessa: {
					vanessasettings: va,
					'bddrunner-path': CI_BDDRUNNER_PATH,
					additional: TEST_ADDITIONAL,
				},
			},
		},
	};
}


export const HOOKS_DEFAULTS = {
	$schema: HOOKS_SCHEMA,
	version: 1 as const,
	hooks: {} as Record<string, unknown>,
};

export const PIPELINES_DEFAULTS = {
	$schema: PIPELINES_SCHEMA,
	version: 1 as const,
	pipelines: [] as unknown[],
};
