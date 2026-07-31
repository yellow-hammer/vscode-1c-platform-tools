# Картинки README и walkthrough

`treeview-screenshot.svg` — источник главной картинки README. Растровая версия
`treeview-screenshot.png` собирается из него, потому что VS Code Marketplace не
принимает SVG в README.

Пересобрать после правки исходника:

```
"C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe" --headless --disable-gpu ^
  --force-device-scale-factor=2 --window-size=900,500 ^
  --screenshot=resources\treeview-screenshot.png resources\treeview-screenshot.svg
```

Двойной масштаб нужен, чтобы картинка оставалась чёткой на экранах с высокой
плотностью: GitHub показывает её уменьшенной.

Картинки шагов walkthrough лежат в `walkthrough/images` и подключаются как есть:
там SVG допустим, шаги рисует сам VS Code.
