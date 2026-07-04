#!/usr/bin/env python3
"""
Packs-Selector — браузер Modrinth для модов, ресурспаков и шейдеров.

Запускается автономно или из лаунчера (Underworld / MAPI).
"""

from __future__ import annotations

import argparse
import hashlib
import os
import socket
import sys
import time
from pathlib import Path
from typing import Dict, Optional, Set

import requests

VALID_PACKS = frozenset({"mod", "resourcepack", "shader"})
PACK_ALIASES = {
    "mods": "mod",
    "mod": "mod",
    "resourcepacks": "resourcepack",
    "resourcepack": "resourcepack",
    "textures": "resourcepack",
    "texture": "resourcepack",
    "shaderpacks": "shader",
    "shader": "shader",
    "shaders": "shader",
}

SCRIPT_DIR = Path(__file__).resolve().parent
DEFAULT_WEB_DIR = SCRIPT_DIR / "web"


def parse_pack_list(raw: str) -> Set[str]:
    items: Set[str] = set()
    for part in raw.split(","):
        key = part.strip().lower()
        mapped = PACK_ALIASES.get(key)
        if mapped:
            items.add(mapped)
    return items


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        description="Packs-Selector — установка модов, текстур и шейдеров с Modrinth",
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog="""
Примеры:
  python packs_selector.py
  python packs_selector.py -path "C:/Games/.minecraft" -version 1.21.1 -loader neoforge
  python packs_selector.py -path "../test_launcher/instances/under" -packs resourcepack
  python packs_selector.py -path "../test_launcher/instances/under" -packs shader -port 8765
  python packs_selector.py -path "D:/mc" -packs mod -server
        """,
    )

    parser.add_argument(
        "-path", "--game-path",
        dest="game_path",
        metavar="DIR",
        help="gameDirectory Minecraft (папка с mods/, resourcepacks/, shaderpacks/)",
    )
    parser.add_argument(
        "-version", "--mc-version",
        dest="mc_version",
        metavar="VER",
        help="Версия Minecraft для фильтра Modrinth (например 1.21.1)",
    )
    parser.add_argument(
        "-loader",
        dest="loader",
        metavar="NAME",
        help="Модлоадер: fabric, forge, neoforge, quilt (только для вкладки модов)",
    )
    parser.add_argument(
        "-packs",
        default="mod,resourcepack,shader",
        metavar="LIST",
        help="Включённые типы через запятую: mod, resourcepack, shader (по умолчанию все)",
    )
    parser.add_argument(
        "-server",
        action="store_true",
        help="Устарело: только моды (эквивалент -packs mod)",
    )
    parser.add_argument(
        "-port",
        type=int,
        default=8765,
        help="Порт веб-интерфейса Eel (по умолчанию 8765, не 8000)",
    )
    parser.add_argument(
        "-host",
        default="127.0.0.1",
        help="Хост для веб-интерфейса (по умолчанию 127.0.0.1)",
    )
    parser.add_argument(
        "--web-dir",
        dest="web_dir",
        metavar="DIR",
        help="Папка с index.html (по умолчанию ./web рядом со скриптом)",
    )
    parser.add_argument(
        "--width",
        type=int,
        default=1400,
        help="Ширина окна",
    )
    parser.add_argument(
        "--height",
        type=int,
        default=900,
        help="Высота окна",
    )
    parser.add_argument(
        "--pos-x",
        type=int,
        default=100,
        help="Позиция окна по X",
    )
    parser.add_argument(
        "--pos-y",
        type=int,
        default=50,
        help="Позиция окна по Y",
    )
    parser.add_argument(
        "--browser",
        choices=("chrome", "edge", "default", "app"),
        default="chrome",
        help="Режим браузера Eel (chrome рекомендуется на Windows)",
    )
    parser.add_argument(
        "--lock-filters",
        action="store_true",
        help="Скрыть фильтры версии/лоадера, если заданы -version и -loader",
    )
    parser.add_argument(
        "--launcher",
        action="store_true",
        help="Режим лаунчера: обязательны -version и -loader, включает --lock-filters",
    )
    parser.add_argument(
        "--quiet",
        action="store_true",
        help="Меньше сообщений в консоли",
    )
    parser.add_argument(
        "--no-scan",
        action="store_true",
        help="Не сканировать установленные файлы при старте",
    )
    parser.add_argument(
        "--shutdown-delay",
        type=int,
        default=30,
        help="Секунд до завершения после закрытия окна",
    )
    return parser


def resolve_game_path(raw: Optional[str]) -> Path:
    if not raw:
        return (Path.home() / ".minecraft").resolve()
    candidate = Path(raw)
    if candidate.is_absolute():
        return candidate.resolve()
    return (Path.cwd() / candidate).resolve()


def pick_port(host: str, preferred: int, attempts: int = 5) -> int:
    for offset in range(attempts):
        port = preferred + offset
        with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as sock:
            sock.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
            try:
                sock.bind((host, port))
                return port
            except OSError:
                continue
    return preferred


if __name__ == "__main__" and any(flag in sys.argv for flag in ("-h", "--help")):
    build_parser().print_help()
    sys.exit(0)

import eel  # noqa: E402

args = build_parser().parse_args()

if args.launcher:
    args.lock_filters = True
    if not (args.mc_version and str(args.mc_version).strip()):
        print("Ошибка: в режиме --launcher обязателен -version / --mc-version", file=sys.stderr)
        sys.exit(2)
    if not (args.loader and str(args.loader).strip()):
        print("Ошибка: в режиме --launcher обязателен -loader", file=sys.stderr)
        sys.exit(2)

ENABLED_PACKS: Set[str] = {"mod"} if args.server else parse_pack_list(args.packs)
if not ENABLED_PACKS:
    ENABLED_PACKS = set(VALID_PACKS)

GAME_PATH = resolve_game_path(args.game_path)
MODS_PATH = GAME_PATH / "mods"
RESOURCEPACKS_PATH = GAME_PATH / "resourcepacks"
SHADERPACKS_PATH = GAME_PATH / "shaderpacks"
WEB_DIR = Path(args.web_dir).resolve() if args.web_dir else DEFAULT_WEB_DIR

QUIET = args.quiet


def log(message: str) -> None:
    if not QUIET:
        print(message)


log(f"Путь к игре: {GAME_PATH}")
log(f"Типы паков: {', '.join(sorted(ENABLED_PACKS))}")
log(f"Версия MC: {args.mc_version or '—'}")
log(f"Лоадер: {args.loader or '—'}")
log(f"UI: http://{args.host}:{args.port}")


def ensure_dir(path: Path) -> bool:
    try:
        path.mkdir(parents=True, exist_ok=True)
        return True
    except OSError as exc:
        print(f"Не удалось создать {path}: {exc}", file=sys.stderr)
        return False


dirs_to_create = [GAME_PATH]
if "mod" in ENABLED_PACKS:
    dirs_to_create.append(MODS_PATH)
if "resourcepack" in ENABLED_PACKS:
    dirs_to_create.append(RESOURCEPACKS_PATH)
if "shader" in ENABLED_PACKS:
    dirs_to_create.append(SHADERPACKS_PATH)

for folder in dirs_to_create:
    if not ensure_dir(folder):
        sys.exit(1)

file_info_cache: Dict[str, dict] = {}
installed_hashes: Dict[str, Dict[str, str]] = {}


def get_install_path(pack_type: str) -> Optional[Path]:
    return {
        "mod": MODS_PATH,
        "resourcepack": RESOURCEPACKS_PATH,
        "shader": SHADERPACKS_PATH,
    }.get(pack_type)


def compute_sha1(file_path: Path) -> Optional[str]:
    sha1 = hashlib.sha1()
    try:
        with file_path.open("rb") as handle:
            while chunk := handle.read(65536):
                sha1.update(chunk)
        return sha1.hexdigest()
    except OSError as exc:
        log(f"Ошибка хеша {file_path}: {exc}")
        return None


def scan_installed_files() -> Dict[str, Dict[str, str]]:
    global installed_hashes
    installed_hashes = {"mods": {}, "resourcepacks": {}, "shaders": {}}

    scan_map = []
    if "mod" in ENABLED_PACKS:
        scan_map.append(("mods", MODS_PATH))
    if "resourcepack" in ENABLED_PACKS:
        scan_map.append(("resourcepacks", RESOURCEPACKS_PATH))
    if "shader" in ENABLED_PACKS:
        scan_map.append(("shaders", SHADERPACKS_PATH))

    for pack_key, folder in scan_map:
        if not folder.is_dir():
            continue
        log(f"Сканирую {folder}")
        for file_path in folder.iterdir():
            if not file_path.is_file():
                continue
            digest = compute_sha1(file_path)
            if digest:
                installed_hashes[pack_key][digest] = file_path.name

    return installed_hashes


def get_mod_info_by_hash(file_hash: str) -> Optional[dict]:
    if file_hash in file_info_cache:
        return file_info_cache[file_hash]

    url = f"https://api.modrinth.com/v2/version_file/{file_hash}"
    try:
        response = requests.get(url, params={"algorithm": "sha1"}, timeout=15)
        response.raise_for_status()
        data = response.json()
        info = {
            "project_id": data.get("project_id"),
            "version": data.get("version_number", "0.0.0"),
        }
        file_info_cache[file_hash] = info
        return info
    except requests.RequestException as exc:
        log(f"Modrinth {file_hash}: {exc}")
        return None


@eel.expose
def get_installed_hashes():
    return scan_installed_files()


@eel.expose
def get_mod_info(hashes):
    results = {}
    for file_hash in hashes:
        info = get_mod_info_by_hash(file_hash)
        if info:
            results[file_hash] = info
    return results


@eel.expose
def download_and_install(project_id, slug, project_type, version_id, title):
    if project_type not in ENABLED_PACKS:
        return {
            "success": False,
            "message": f"Тип «{project_type}» отключён (запуск с -packs {','.join(sorted(ENABLED_PACKS))})",
        }

    try:
        version_res = requests.get(
            f"https://api.modrinth.com/v2/version/{version_id}",
            timeout=15,
        )
        version_res.raise_for_status()
        version_data = version_res.json()

        primary_file = None
        for entry in version_data.get("files", []):
            if entry.get("primary"):
                primary_file = entry
                break
        if not primary_file and version_data.get("files"):
            primary_file = version_data["files"][0]
        if not primary_file:
            raise ValueError("Файл для загрузки не найден")

        install_path = get_install_path(project_type)
        if not install_path:
            raise ValueError(f"Неизвестный тип: {project_type}")

        install_path.mkdir(parents=True, exist_ok=True)
        target = install_path / primary_file["filename"]

        file_res = requests.get(primary_file["url"], timeout=120)
        file_res.raise_for_status()
        target.write_bytes(file_res.content)

        log(f"Установлено: {title} → {target}")
        return {"success": True, "message": f"Успешно установлен: {title}"}
    except Exception as exc:
        return {"success": False, "message": f"Ошибка при установке {title}: {exc}"}


@eel.expose
def get_installation_path():
    return str(GAME_PATH)


@eel.expose
def test_connection():
    return "ok"


@eel.expose
def get_launch_params():
    return {
        "version": args.mc_version,
        "loader": args.loader,
        "server": args.server,
        "packs": sorted(ENABLED_PACKS),
        "lockFilters": bool(args.lock_filters),
        "gamePath": str(GAME_PATH),
    }


if not WEB_DIR.is_dir():
    print(f"Папка web не найдена: {WEB_DIR}", file=sys.stderr)
    sys.exit(1)

eel.init(str(WEB_DIR))


if __name__ == "__main__":
    try:
        requests.get("https://api.modrinth.com", timeout=5)
        log("Modrinth доступен")
    except requests.RequestException as exc:
        log(f"Modrinth недоступен: {exc}")

    if not args.no_scan:
        started = time.time()
        scan_installed_files()
        log(f"Сканирование: {time.time() - started:.2f} сек")

    port = pick_port(args.host, args.port)
    if port != args.port:
        log(f"Порт {args.port} занят, использую {port}")

    eel.start(
        "index.html",
        host=args.host,
        size=(args.width, args.height),
        position=(args.pos_x, args.pos_y),
        mode=args.browser,
        port=port,
        shutdown_delay=args.shutdown_delay,
    )
