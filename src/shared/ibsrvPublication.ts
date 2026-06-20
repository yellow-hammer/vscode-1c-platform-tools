/**
 * Генерация конфигурации автономного сервера (ibsrv) и построение URL.
 *
 * Конфиг — единый YAML, описывающий сервер, базу и публикацию. Формат проверен
 * на платформе 8.5.1 (эталон — `ibcmd server config init`):
 *   - булевы значения пишутся как `yes`/`no`;
 *   - секция `http:` — это ПОСЛЕДОВАТЕЛЬНОСТЬ публикаций (каждая со своим `base`
 *     и подсекциями odata/web-services/http-services);
 *   - при наличии конфига сервис публикуется, только если это указано явно
 *     (поэтому в конфиг всегда включаются подсекции публикации).
 * Сервер запускается как `ibsrv --data=<dir> --config=<file>`.
 */

/**
 * Выбор публикации для категории сервисов (Web- или HTTP-сервисы).
 *
 * `publishByDefault: true` — публикуются все сервисы категории; список `services`
 * при этом игнорируется. Иначе публикуются только перечисленные в `services`
 * (пустой список — не публикуется ничего). Для перечисленных сервисов корневой
 * URL/синоним берёт из метаданных сам ibsrv (указываем только имя).
 */
export interface ServiceSelection {
	/** Публиковать все сервисы категории. */
	publishByDefault: boolean;
	/** Имена конкретных сервисов (когда publishByDefault = false). */
	services: string[];
}

/** Что публиковать автономным сервером. */
export interface PublicationOptions {
	/** Публиковать стандартный интерфейс OData. */
	odata: boolean;
	/** Публикация Web-сервисов (SOAP). */
	webServices: ServiceSelection;
	/** Публикация HTTP-сервисов. */
	httpServices: ServiceSelection;
}

/** Параметры генерации конфигурации автономного сервера. */
export interface ServerConfigOptions {
	/** Сетевой интерфейс (localhost/any/IP). */
	host: string;
	/** HTTP-порт. */
	port: number;
	/** Абсолютный путь к каталогу файловой ИБ. */
	dbPath: string;
	/** Имя информационной базы автономного сервера. */
	infobaseName: string;
	/** Разрешить выдачу клиентских лицензий. */
	distributeLicenses: boolean;
	/** Базовый путь публикации (нормализуется). */
	base: string;
	/** Что публиковать. */
	publication: PublicationOptions;
}

/** Параметры сервера, прочитанные из существующего конфига публикации. */
export interface ParsedServerParams {
	/** Сетевой интерфейс (server.address). */
	host?: string;
	/** HTTP-порт (server.port). */
	port?: number;
	/** Базовый путь публикации (http[].base). */
	base?: string;
	/** Выдача лицензий (infobase.distribute-licenses). */
	distributeLicenses?: boolean;
}

/**
 * Извлекает параметры сервера из YAML-конфига публикации.
 *
 * Используется, чтобы учитывать ручные правки файла (например, порт): конфиг —
 * источник истины для уже созданного файла. Парсер рассчитан на формат, который
 * генерирует {@link buildServerConfigYaml}.
 *
 * @param yaml - Содержимое конфигурационного файла
 * @returns Найденные параметры (отсутствующие — undefined)
 */
export function parseServerConfigParams(yaml: string): ParsedServerParams {
	const host = yaml.match(/^\s*address:\s*(\S+)\s*$/m)?.[1];
	const portStr = yaml.match(/^\s*port:\s*(\d+)\s*$/m)?.[1];
	const base = yaml.match(/^\s*-\s*base:\s*(\S+)\s*$/m)?.[1];
	const lic = yaml.match(/^\s*distribute-licenses:\s*(yes|no)\b/m)?.[1];
	return {
		host: host || undefined,
		port: portStr ? Number(portStr) : undefined,
		base: base || undefined,
		distributeLicenses: lic ? lic === 'yes' : undefined,
	};
}

/** Адреса опубликованной информационной базы. */
export interface ServerUrls {
	/** Корень публикации, например http://localhost:8314/ib/ */
	root: string;
	/** OData $metadata. */
	odataMetadata: string;
}

/**
 * Приводит базовый путь публикации к каноничному виду без ведущих/замыкающих `/`.
 *
 * `'/'`, `''`, `'/ib/'`, `'ib'` → `''`, `''`, `'ib'`, `'ib'` соответственно.
 *
 * @param base - Базовый путь публикации из настроек
 * @returns Нормализованный сегмент (без слэшей) или пустая строка для корня
 */
export function normalizeHttpBase(base: string | undefined): string {
	if (!base) {
		return '';
	}
	return base.trim().replace(/^\/+/, '').replace(/\/+$/, '');
}

/**
 * Преобразует булево в литерал YAML, понятный ibsrv (`yes`/`no`).
 *
 * @param value - Значение
 * @returns 'yes' или 'no'
 */
function yamlBool(value: boolean): string {
	return value ? 'yes' : 'no';
}

/**
 * Формирует строки секции категории сервисов (web-services/http-services).
 *
 * @param key - Ключ секции YAML (`web-services` или `http-services`)
 * @param selection - Выбор публикации категории
 * @returns Строки YAML с отступом публикации (уровень внутри элемента http)
 */
function serviceSectionLines(key: string, selection: ServiceSelection): string[] {
	const lines = [
		`    ${key}:`,
		`      publish-by-default: ${yamlBool(selection.publishByDefault)}`,
	];
	if (!selection.publishByDefault && selection.services.length > 0) {
		lines.push('      service:');
		for (const name of selection.services) {
			lines.push(`        - name: ${name}`, '          publish: yes');
		}
	}
	return lines;
}

/**
 * Строит полный YAML-конфиг автономного сервера для `ibsrv --config`.
 *
 * @param options - Параметры сервера и публикации
 * @returns Текст YAML-файла (с завершающим переводом строки)
 */
export function buildServerConfigYaml(options: ServerConfigOptions): string {
	const segment = normalizeHttpBase(options.base);
	const base = segment ? '/' + segment : '/';
	const lines = [
		'server:',
		`  address: ${options.host}`,
		`  port: ${options.port}`,
		'database:',
		`  path: ${options.dbPath}`,
		'infobase:',
		`  name: ${options.infobaseName}`,
		`  distribute-licenses: ${yamlBool(options.distributeLicenses)}`,
		'http:',
		`  - base: ${base}`,
		'    odata:',
		`      publish: ${yamlBool(options.publication.odata)}`,
		...serviceSectionLines('web-services', options.publication.webServices),
		...serviceSectionLines('http-services', options.publication.httpServices),
	];
	return lines.join('\n') + '\n';
}

/**
 * Строит адреса опубликованной ИБ.
 *
 * @param host - Хост (например, 'localhost')
 * @param port - HTTP-порт сервера
 * @param base - Базовый путь публикации (нормализуется)
 * @returns Набор URL (корень, OData $metadata)
 */
export function buildServerUrls(host: string, port: number, base: string | undefined): ServerUrls {
	const segment = normalizeHttpBase(base);
	const root = `http://${host}:${port}/${segment ? segment + '/' : ''}`;
	return {
		root,
		odataMetadata: `${root}odata/standard.odata/$metadata`,
	};
}

/**
 * Строит URL конкретного HTTP-сервиса по его корневому пути.
 *
 * @param urls - Базовые адреса (см. {@link buildServerUrls})
 * @param serviceRoot - Корневой URL HTTP-сервиса (свойство сервиса в метаданных)
 * @returns URL вида http://host:port/<base>/hs/<root>
 */
export function buildHttpServiceUrl(urls: ServerUrls, serviceRoot: string): string {
	return `${urls.root}hs/${serviceRoot.replace(/^\/+/, '')}`;
}
