# Карта кода Проявки

Весь редактор — один `index.html` (~9 100 строк). Номеров строк здесь нет, они плывут с каждой
правкой. Вместо них — **заголовки разделов**: в коде они стоят как `/* ============ заголовок ============ */`.
Точное место даёт скрипт:

```
python3 tools/map.py              # все разделы с номерами строк
python3 tools/map.py -f           # плюс функции каждого раздела
python3 tools/map.py smart        # только то, где встречается «smart»
python3 tools/map.py градиент     # русское название само переводится в имя из кода (grad)
```

Имена функций в коде английские. Частые соответствия: Градиент — `grad*`, Доводка — `detail*`,
Рефы — `ref*`, История — `hist*`, Островок — `island*`, Смарт-объекты — `smart*`, Марионетка —
`pup*`, Пластика — `liq*`, Кадрирование — `crop*`, Арт-директор — `crit*` / `notes*`, «Сдать кат» —
`deliver*`, «Реф с позы» — `poseRef*`, AI Edit — `ae*`, корректирующие слои — `adj*`
(карта градиента — `gmap*`, выборочная — `selc*`). Полный список — `ALIASES` в `tools/map.py`.

Новый крупный раздел — заводить своим заголовком `/* ============ №NN Название ============ */`,
тогда он сам появится в `tools/map.py`. Сюда — одна строка в нужную группу.

## Устройство файла сверху вниз

| Блок | Что там |
|---|---|
| `<script>` «black box» в `<head>` | бортовой журнал ошибок и этапов запуска (переживает падение) |
| `<script>` №88 до первой отрисовки | тема и фон вокруг холста ставятся до показа страницы |
| `<style>` (первый) | базовая вёрстка |
| `<style id="polish">` | стекло, акцент, ритм (№33) |
| `<style id="themes">` | 4 темы: Ночь / Облачко / Луч / Графит. **Новые элементы красить только переменными** |
| разметка `<body>` | панели, окна, меню |
| `<script type="text/plain" id="pmSrc">` | код воркера PatchMatch (заливка с учётом содержимого) |
| главный `<script>` | всё остальное, разделы ниже |
| последний `<script>` | service worker, проверка новой версии (`checkUpdate`), автоподключение моста на ПК (`pcAutoConnect`) |

Вокруг: `sw.js` (кэш `proyavka-shell-vNN` — поднимать номер, когда добавляется файл, который
нужен офлайн), `version.json`, `vendor/` (ag-psd, fflate, onnxruntime-web, шрифты), `models/`
(по частям ≤12 МБ), `assets/`, `icons/`, `pc-app/` (Electron-оболочка ПК), `pc-bridge/` (мост
на Python: SD/A1111, нейросети ПК, прокси облака), `ios/` (оболочка для айпада, выпуск отложен).

## Разделы главного скрипта (по группам)

**Основа**
- `basics` — `$`, `toast`, `busy`, `clamp`, имена режимов наложения ↔ PSD.
- `state` — глобальное состояние `S` (инструмент, цвета, размеры), `doc`.
- `document & layers` + `groups` — `newLayer`, `newMask`, `createDoc`; слои — плоский список снизу
  вверх, у группы заголовок над участниками (`kidsOf`, `depthOf`, `pixelOnly`).
- `Photoshop blend modes the canvas does not have` — 27 режимов, `blendDraw` (GPU для того, чего
  нет в canvas), **`composeTree`** (сведение дерева слоёв), `clipComposite` (обтравка), `structEdit`
  (структурная правка одной отменой).
- `view` — `fitView`, `toDoc`/`toScr` (экран ↔ документ).
- `rendering` — `render`, `composeAll`, кэш «живого слоя» (`liveLayer`, `strokeCacheBuild`,
  `renderStrokePart`), миниатюра-навигатор, `drawLayer`.
- `history` — **`pushHist`** (все шаги отмены идут через него), `pxEntry`, `compound`, `undo/redo`,
  бюджет памяти истории.

**Рисование и выделение**
- `brush`, `brush library` (+ `import`, `library popover`) — кисти, импорт .abr / .brush / .brushset,
  движок мазка `strokeBegin/Move/Feed/Finish`, `dab`.
- `eyedropper`; `selection` — `normRect`, `snapshotSel` (маска в истории сжата fflate), `copySel` /
  `pasteClip` (свой буфер `clip`), `selShift` (сдвиг контура).
- `select subject (ISNet)`, `tap to select object (MobileSAM)`, `magic wand`, `selection edge`.
- `dodge / burn / blur / sharpen` — тон кистью плитками; там же `selectSubject` / `pcSubject` /
  `removeBackground` (BiRefNet на ПК).
- `retouch` — заплатка, восстанавливающая кисть, штамп (`seamless` = Пуассон).
- `removal` — отсек нейросетей (`mlWorker`, `mlSession`), те же сети на ПК (`pcML`), MI-GAN; удаление мазком считается тихо (`busyLite`, мерцающий след `inpaintPend`).
- `content-aware fill` — PatchMatch в воркере, **`compositeRegion`** (видимое сведение куска).

**Фильтры, тон, коррекции**
- `depth map` (+ «За объект», «Коррекция», «Свет») — Depth Anything V2, дымка, свет по глубине.
- `lens blur` (GPU) и `layer filters` (Гаусс, резкость; `blendByMask`).
- `liquify` — пластика на поле смещений (`liqDab`, `lqRender`).
- `adjustment layers` (+ `the colour function of each kind`, `WebGL2`, `creating and editing`) —
  кривые, уровни, цветовой тон, баланс, **карта градиента**, **выборочная коррекция**; LUT 64³,
  `adjComposite`, `clipBase`, `adjForPsd`.
- `harmonization` — Oklab-статистики, `compositeBelow`.

**ИИ и облако**
- `generative fill` + `Google AI Studio` — провайдеры (`edProv`), `ggImage`, `ggVision`,
  **`cloudFetch`** (облако через мост ПК), fal.ai.
- `OpenRouter: shared request + four tools` — **`orRequest`** (общий запрос на картинку), общее
  ИИ-окно `aiOpen/aiGo/aiPick/aiDone/aiCancel`; 1 Вписать в сцену, 2 Отрисовать, 3 Расширить кадр
  (`canvasExpand`, `expandAlign`), 4 Арт-директор (`critRun`) и заметки на полях (`notes*`).
- `SD Inpaint` — Automatic1111 через мост (`sdBase`, `bridgePick` — дом / Tailscale), ⚙ генерации
  (`genSettings`); F2 «SD-ретушь» без панели — `sdQuick`, промпт из плагина ФШ — `sdPreset` (мост `/proyavka/sdpreset`).
- `object move` — «Сдвинуть объект» (Stardust), тень, перерисовать фон.
- `AI Edit: the Photoshop plugin itself` (+ masks, image data, layers, executeAsModal, imaging,
  batchPlay, files) — **подмена API Фотошопа** для плагина. Код самого плагина не здесь и не наш.
- Доводка — подраздел `Доводка: a frame of a model-native shape…` внутри «Кадрирования»:
  `detailRun`, `detailMask`, `refUnder`, шаблоны и недавние промпты. В коде и ключах — `detail*`.
- «Реф с позы» — `poseRefOpen` в разделе `№89`.

**Трансформ и геометрия**
- `transform` — `beginTransform`, `beginGroupTransform`, `xfApply`; смарт-объекты подключаются
  отсюда (`smartTo`).
- `Марионеточная деформация` (+ solver, GPU, pins, panel).
- `Кадрирование (C), Размер холста, Размер изображения` — `canvasReframe` (общий механизм
  обрезки/расширения), рамка кадрирования, `imageResize` (Lanczos на GPU, ИИ-апскейл через мост).
- `№109 Смарт-объекты` — `L.smart = {src, M}`, `smartRender`, `smartBeginTransform`,
  `smartAutoRaster`, PSD (`pngSync`, `smartFromPsd`).

**Слои и интерфейс**
- `layers ops` + `several layers at once` — выделение нескольких слоёв (`doc.pick`, `pickTops`),
  меню слоя `layerMenu`, `toggleClip`, `mergeGroup`, `dupLayer`.
- `layers panel` — список слоёв `showLayers`, `layersChanged`, миниатюры, `adjIcon`.
- `tools & options UI` — группы левой панели `TOOL_GROUPS` (псевдо-пункты `@subject`, `@puppet` → `groupRun`), `setTool`, верхняя строка настроек `renderOpts`, свои ползунки `hslider`.
- `colour picker` — палитра, `maskColorSync` (на маске только ч/б).
- `several open documents (tabs)` — вкладки (`tabSwitch`, `tabsAdopt`), **`panelBusy` / `aiSettle` /
  `tabBusy`** (что можно делать при открытой панели), размещение окон (`dockPlace`, `aiDockPlace`,
  `airailLayout`, `tabsLayout`).
- `dialogs` — `dialog()`, справка `showHelpDesk` (ПК) / `showHelpPad` (iPad), новый документ.
- `files` — `openPsd`, `placeFile`, `flatten`, фоновое кодирование PNG.
- `the PC speaks PC` — `deskText` + `DESK_PHRASES` / `DESK_WORDS` (тексты ПК-версии);
  `saveAsDesk`, `exportImg`, **`psdBuffer`** (вся запись PSD).
- `№107 «Сдать кат»` — `deliverChecks`, `deliverGo`.
- `№89` — файл документа (`docBindFile`, `fileHandle`), безопасная зона, линейки, «Реф с позы».
- `№104 «Рефы»`, `№108 История`, `№101 «Островок»`, `№88 interface themes`.
- `№110 Второй экран` — окно для очков / второго монитора (`s2Open`, `s2Tick`, `s2Draw`, `s2DrawRefs`), оболочка ставит его на другой монитор (`placeScreen2` в `pc-app/main.js`); «Курсор пера в воздухе» (`hoverCross`).
- `selection bar & transform bar`, `input` (все мышь/перо/клавиши: `toolDown/Move/Up`, курсоры,
  зум), `helpers for the Photoshop keys` (+ №105 Градиент, `mergeVisible`, `selFromLayer`).

**Хранение и запуск**
- `prefs & autosave` + `documents library` — IndexedDB, `d:<id>:…`.
- `№87 accounts` — заготовка входа (выключена), **`autosave` / `restore`** тоже живут здесь.
- `№86 home screen` — «Начало», `closeToHome`.
- `storage diagnostics`, `boot`.

## Сквозные правила кода (на них уже обжигались)

- **Новый тип слоя** (как корректирующий, смарт) — перехватить в `composeTree` и пройти все места,
  где перебираются слои: `memMB`/`layersMB`, `autosave`/`restore`, слить вниз/видимые, копия,
  трансформ, PSD (запись `psdBuffer` и чтение `openPsd`), `pixelOnly`. Сохраняемые слои создавать
  с `dirty:true, saved:false`.
- **Отмена.** Каждый шаг — через `pushHist`; структурные правки — `structEdit`; несколько действий
  одной отменой — `compound`. Название шага для панели «История» берётся само по имени функции
  (`HIST_FN`), новую функцию-действие стоит туда добавить.
- **Смарт-объекты.** Правка пикселей смарт-слоя без `smartOk` сама растрирует его (`smartAutoRaster`
  в обёртке `pushHist`). Новый инструмент рисования — проверить, что по смарту он блокируется
  (`pixelOnly`) или растрирует с тостом.
- **Панели и окна.** Новое окно — через `dockPlace` (тянется за заголовок, место помнит).
  Новая операция не должна запускаться поверх открытой панели — проверка `panelBusy()`;
  ИИ-окно с готовым вариантом закрывается само через `aiSettle()`.
- **Цвета** — только переменные темы (`--accent`, `--fg`, `--muted`, `--soft*`, `--line*`,
  `--field`, `--ai`, `--glass-*`). Фон вокруг холста (`BG`) от темы не зависит.
- **ПК-тексты.** Тексты пишутся как обычно («тап»), ПК переводит сам; кривая фраза — в
  `DESK_PHRASES`. Новые клавиши — как в Фотошопе, по физической клавише (`e.code`).
- **Айпад.** `ctx.filter` в Safari не гарантирован — фильтры в JS или WebGL2. Нативные
  `<input type=range>` ловят Pencil — только свои `hslider`. Текстовые поля — только чтение до
  тапа (Scribble). Бюджет документа ≈350 МБ; большие буферы отпускать сразу. Safari теряет
  `pointerup` пера — мазок закрывается по новому касанию.
- **Многократный canvas-композитинг мягких отпечатков темнит** — считать во float.
- **Деформации** — только через поле смещений от оригинала (пластика, марионетка).
- **Кнопки в разметке** — проверять, что обработчик подключён.
- **Класс `.hs`** занят слайдером.

## Ключи хранилища

localStorage (`proyavka.*`): `gen` (все настройки генерации и ключи — **не печатать**), `theme`,
`paste` (фон вокруг холста), `cur` (текущий документ), `tabs`, `home`, `booting` (защита от
падения), `trail` (бортовой журнал), `aidock`, `refwin`, `histwin`, `island`, `notesPos`,
`hints`, `aiedit.hints`, `rulers`, `detail.tpl`, `detail.recent`, `brushOver`, `groups`,
`psLast`, `device`, `session`, `auth`, `visits`; ещё `kadr.prefs`, `kadr.help`.

IndexedDB `kadr`, хранилище `doc`: `library` (список документов), `d:<id>:meta`, `d:<id>:c<слой>`
(пиксели), `d:<id>:m<слой>` (маска), `d:<id>:s<слой>` (оригинал смарт-объекта), `d:<id>:thumb`,
`d:<id>:fh` (файл на диске), `d:<id>:ref…` (рефы), `deliverDir`, `brushlib` (импортированные кисти).
Модели нейросетей — отдельная база `proyavka-models`, частями.

## Тесты

`python3 tests/run.py` — подробно в `tests/README.md`. Шаги в `tests/smoke.js` вызывают функции
Проявки напрямую (`createDoc`, `placeFile`, `psdBuffer`, `openPsd`, `poseRefOpen`, `aiGo`, `critRun`…) —
при переименовании таких функций поправить и тест.
