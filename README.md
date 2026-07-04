# Packs-Selector

Браузер [Modrinth](https://modrinth.com) для установки **модов**, **ресурспаков** и **шейдеров** в папку Minecraft (`gameDirectory`).

Работает **автономно** (отдельное окно) и **из лаунчера** Underworld / MAPI — с настраиваемым набором вкладок и фильтров.

## Возможности

- Поиск и установка с Modrinth API
- Вкладки: моды, текстуры, шейдеры (можно включать по отдельности)
- Фильтр по версии Minecraft и модлоадеру
- Определение уже установленных файлов по SHA1
- Параметры командной строки для встраивания в лаунчер

## Требования

- Python 3.10+
- Google Chrome или Microsoft Edge (для режима Eel)
- Интернет (Modrinth API)

```bash
pip install -r requirements.txt
```

## Быстрый старт

```bash
# Все вкладки, папка по умолчанию ~/.minecraft
python packs_selector.py

# Конкретный инстанс лаунчера
python packs_selector.py -path "../test_launcher/instances/under" -version 1.21.1 -loader neoforge

# Только текстуры
python packs_selector.py -path "../test_launcher/instances/under" -packs resourcepack -version 1.21.1

# Только шейдеры
python packs_selector.py -path "../test_launcher/instances/under" -packs shader -version 1.21.1

# Только моды (как старый -server)
python packs_selector.py -path "C:/Games/.minecraft" -packs mod -version 1.21.1 -loader fabric
```

## Параметры запуска

| Параметр | Описание |
|----------|----------|
| `-path`, `--game-path` | `gameDirectory` — папка с `mods/`, `resourcepacks/`, `shaderpacks/` |
| `-version`, `--mc-version` | Версия Minecraft для фильтра Modrinth |
| `-loader` | Модлоадер: `fabric`, `forge`, `neoforge`, `quilt` |
| `-packs` | Типы через запятую: `mod`, `resourcepack`, `shader` (по умолчанию все три) |
| `-server` | Устарело → эквивалент `-packs mod` |
| `-port` | Порт UI (по умолчанию **8765**, не 8000) |
| `-host` | Хост UI (по умолчанию `127.0.0.1`) |
| `--web-dir` | Путь к папке `web/` (по умолчанию рядом со скриптом) |
| `--width`, `--height` | Размер окна |
| `--pos-x`, `--pos-y` | Позиция окна |
| `--browser` | `chrome`, `edge`, `default`, `app` |
| `--lock-filters` | Скрыть фильтры версии/лоадера, если они заданы |
| `--quiet` | Меньше логов в консоли |
| `--no-scan` | Не сканировать файлы при старте |
| `--shutdown-delay` | Секунд до выхода после закрытия окна |

Справка: `python packs_selector.py -h`

## Структура проекта

```
Packs-Selector/
├── packs_selector.py   # Точка входа, Eel API, Modrinth
├── web/
│   ├── index.html
│   ├── script.js
│   └── style.css
├── requirements.txt
└── README.md
```

## Интеграция с лаунчером

В репозитории `LaunchDEVELOP` лаунчер лежит рядом:

```
LaunchDEVELOP/
├── Packs-Selector/          ← этот репозиторий
├── test_launcher/           ← PyQt6 лаунчер
└── MAPI/
```

Лаунчер запускает селектор с путём `test_launcher/instances/{slug}/` и параметрами профиля. Кнопки **«Текстуры»** и **«Шейдеры»** передают `-packs resourcepack` или `-packs shader`.

Пример команды из лаунчера:

```bash
python packs_selector.py \
  -path "C:/.../test_launcher/instances/under" \
  -version 1.21.1 \
  -loader neoforge \
  -packs resourcepack \
  -port 8765 \
  --lock-filters \
  --quiet
```

## Заметки

- Порт **8765** выбран, чтобы не конфликтовать с MAPI (`8000`).
- Папки `resourcepacks` и `shaderpacks` в профилях Underworld — **редактируемые** игроком; `mods` и `config` защищены сервером.
- При занятом порте селектор пробует следующие (`8766`, `8767`…).

## Лицензия

MIT (или укажите свою при публикации на GitHub).
