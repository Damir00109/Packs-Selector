import eel
import argparse
import os
import requests
import hashlib
import json
from pathlib import Path
import time
import traceback
import sys
import re
# python packs_selector.py -path="E:\Decompiler\mine" -version="1.21.1" -loader="fabric"
parser = argparse.ArgumentParser(description='Vanilla+ Launcher')
parser.add_argument('-path', type=str, help='Путь к директории Minecraft', default=None)
parser.add_argument('-version', type=str, help='Версия Minecraft для фильтрации', default=None)
parser.add_argument('-loader', type=str, help='Модлоадер для фильтрации', default=None)
args = parser.parse_args()

if args.path:
    if ':' in args.path and args.path.startswith('/') or args.path.startswith('\\'):
        GAME_PATH = Path(args.path)
    else:
        GAME_PATH = Path(os.getcwd()) / args.path
else:
    GAME_PATH = Path.home() / '.minecraft'

GAME_PATH = GAME_PATH.resolve()
MODS_PATH = GAME_PATH / 'mods'
RESOURCEPACKS_PATH = GAME_PATH / 'resourcepacks'
SHADERPACKS_PATH = GAME_PATH / 'shaderpacks'

print(f'📁 Путь к игре: {GAME_PATH}')
print(f'📦 Папка модов: {MODS_PATH}')
print(f'🎨 Папка текстур: {RESOURCEPACKS_PATH}')
print(f'🌈 Папка шейдеров: {SHADERPACKS_PATH}')


def create_dir(path):
    """Создает директорию если она не существует"""
    try:
        if not path.exists():
            path.mkdir(parents=True, exist_ok=True)
            print(f'✅ Создана папка: {path}')
        return True
    except Exception as e:
        print(f'❌ Критическая ошибка: не удалось создать папку {path}: {e}')
        return False


# Создаем необходимые директории
for path in (GAME_PATH, MODS_PATH, RESOURCEPACKS_PATH, SHADERPACKS_PATH):
    if not create_dir(path):
        print(f'❌ Критическая ошибка: не удалось создать папку {path}')
        exit(1)

file_info_cache = {}
installed_hashes = {}


def get_install_path(pack_type):
    """Возвращает путь для установки в зависимости от типа контента"""
    if pack_type == 'mod':
        return MODS_PATH
    elif pack_type == 'resourcepack':
        return RESOURCEPACKS_PATH
    elif pack_type == 'shader':
        return SHADERPACKS_PATH
    else:
        print(f'❓ Неизвестный тип пакета: {pack_type}')
        return None


def compute_sha1(file_path):
    """Вычисляет SHA1 хеш файла"""
    sha1 = hashlib.sha1()
    try:
        with open(file_path, 'rb') as f:
            while True:
                data = f.read(65536)  # 64kb chunks
                if not data:
                    break
                sha1.update(data)
        return sha1.hexdigest()
    except Exception as e:
        print(f'❌ Ошибка при вычислении хеша файла {file_path}: {e}')
        return None


def scan_installed_files():
    """Сканирует установленные файлы и возвращает информацию о них"""
    global installed_hashes
    installed_hashes = {
        'mods': {},
        'resourcepacks': {},
        'shaders': {}
    }

    for pack_type, path in [('mods', MODS_PATH), ('resourcepacks', RESOURCEPACKS_PATH), ('shaders', SHADERPACKS_PATH)]:
        if not path.exists():
            print(f'❓ Папка не существует: {path}')
            continue

        print(f'🔍 Сканирую папку: {path}')
        for file in path.iterdir():
            if not file.is_file():
                continue

            print(f'📄 Обнаружен файл: {file.name}')
            file_hash = compute_sha1(file)
            if not file_hash:
                continue

            installed_hashes[pack_type][file_hash] = str(file.name)
            print(f'🔑 Хеш файла: {file_hash}')

    return installed_hashes


def get_mod_info_by_hash(file_hash):
    """Получает информацию о моде по его хешу"""
    if file_hash in file_info_cache:
        print(f'💾 Использую кеш для хеша: {file_hash}')
        return file_info_cache[file_hash]

    print(f'🌐 Запрос информации для хеша: {file_hash}')
    url = f'https://api.modrinth.com/v2/version_file/{file_hash}'
    params = {
        'algorithm': 'sha1'
    }

    try:
        response = requests.get(url, params=params, timeout=15)
        response.raise_for_status()
        data = response.json()

        file_info_cache[file_hash] = {
            'project_id': data.get('project_id'),
            'version': data.get('version_number', '0.0.0')
        }
        print(f'✅ Получена информация: {file_info_cache[file_hash]}')
        return file_info_cache[file_hash]
    except Exception as e:
        print(f'❌ Ошибка при получении информации для хеша {file_hash}: {e}')
        return None


# Eel exposed functions
@eel.expose
def get_installed_hashes():
    """Получение хешей установленных файлов"""
    print('📊 Получение хешей установленных файлов...')
    return scan_installed_files()


@eel.expose
def get_mod_info(hashes):
    """Получение информации о модах по хешам"""
    print(f'📡 Запрос информации для {len(hashes)} хешей...')
    results = {}
    for file_hash in hashes:
        info = get_mod_info_by_hash(file_hash)
        if not info:
            continue
        results[file_hash] = info

    print(f'✅ Получена информация для {len(results)} файлов')
    return results


@eel.expose
def download_and_install(project_id, slug, project_type, version_id, title):
    """Скачивание и установка контента"""
    print(f'\n🚀 НАЧАЛО УСТАНОВКИ: {title} ({project_type})')
    print(f'📋 Project ID: {project_id}')
    print(f'📋 Version ID: {version_id}')
    print(f'📋 Title: {title}')
    print(f'📋 Slug: {slug}')
    print(f'📋 Type: {project_type}')

    try:
        print('🌐 Запрос информации о версии...')
        version_url = f'https://api.modrinth.com/v2/version/{version_id}'
        version_res = requests.get(version_url, timeout=15)
        version_res.raise_for_status()
        version_data = version_res.json()

        print(f'✅ Получена информация о версии: {version_data["version_number"]}')

        # Ищем primary файл
        primary_file = None
        for file in version_data['files']:
            if file.get('primary', False):
                primary_file = file
                break

        # Если primary не найден, берем первый файл
        if not primary_file and version_data['files']:
            primary_file = version_data['files'][0]

        if not primary_file:
            raise ValueError('Файл для загрузки не найден')

        download_url = primary_file['url']
        filename = primary_file['filename']

        print(f'📦 Файл для загрузки: {filename}')
        print(f'🔗 URL загрузки: {download_url}')

        install_path = get_install_path(project_type)
        if not install_path:
            raise ValueError(f'Неизвестный тип пакета: {project_type}')

        print(f'📁 Путь установки: {install_path}')

        # Создаем директорию если нужно
        if not install_path.exists():
            print(f'📁 Создаем папку: {install_path}')
            install_path.mkdir(parents=True, exist_ok=True)

        file_path = install_path / filename

        print('⏬ Начинаю скачивание...')
        file_res = requests.get(download_url, timeout=60)
        file_res.raise_for_status()

        print(f'✅ Файл успешно скачан ({len(file_res.content)} байт)')

        print(f'💾 Сохранение файла: {file_path}')
        with open(file_path, 'wb') as f:
            f.write(file_res.content)

        print(f'🎉 Установка завершена: {title}')
        return {'success': True, 'message': f'Успешно установлен: {title}'}

    except Exception as e:
        error_msg = f'Ошибка при установке {title}: {str(e)}'
        print(f'❌ {error_msg}')
        return {'success': False, 'message': error_msg}


@eel.expose
def get_installation_path():
    """Получение пути установки игры"""
    return str(GAME_PATH)


@eel.expose
def test_connection():
    """Тест соединения"""
    print('Тестовый вызов из JavaScript получен!')
    return 'Python ответил успешно!'


@eel.expose
def get_launch_params():
    """Получение параметров запуска"""
    return {
        'version': args.version,
        'loader': args.loader
    }


# Инициализация Eel
eel.init('web')

if __name__ == '__main__':
    print('🌐 Проверка соединения с Modrinth...')
    try:
        requests.get('https://api.modrinth.com', timeout=5)
        print('✅ Соединение с Modrinth работает')
    except Exception as e:
        print(f'❌ Ошибка соединения с Modrinth: {e}')

    print('🔍 Сканирование установленных файлов...')
    start_time = time.time()
    scan_installed_files()
    print(f'✅ Сканирование завершено за {time.time() - start_time:.2f} сек')

    # Запуск Eel приложения
    eel.start('index.html', size=(1400, 900), position=(100, 50), mode='chrome', port=8000, shutdown_delay=30)