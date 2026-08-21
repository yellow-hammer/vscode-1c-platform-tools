/** Пишет в stdout байты, заданные шестнадцатеричной строкой. Для тестов кодировки. */
process.stdout.write(Buffer.from(process.argv[2] ?? '', 'hex'));
