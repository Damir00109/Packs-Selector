document.addEventListener('DOMContentLoaded', () => {
  const searchInput = document.getElementById('search-query');
  const perPageBar = document.getElementById('per-page-bar');
  const modsContainer = document.getElementById('mods-container');
  const loader = document.getElementById('loader');
  const errorMessage = document.getElementById('error-message');
  const paginationTop = document.getElementById('pagination-top');
  const paginationBot = document.getElementById('pagination-bottom'); // Проверьте, что ID в HTML именно 'pagination-bottom'
  const filtersColumn = document.getElementById('filters-column');
  const filtersHeader = document.getElementById('filters-header');
  const filtersArrow = document.getElementById('filters-arrow');
  const filtersContent = document.querySelector('.filters-content');
  const snapshotToggle = document.getElementById('snapshot-toggle');
  const contentTypeBar = document.querySelector('.content-type-bar'); // Это объявлено, но не используется в вашем коде

  let currentPage = 1;
  let perPage = 20;
  let selectedVersions = [];
  let selectedLoaders = [];
  let selectedCategories = [];
  let selectedSupport = [];
  let openSource = false;
  let showSnapshots = false;
  let allVersions = [];
  let currentContentType = 'mod';

  // Кеши для хранения информации об установленных файлах
  let installedHashes = { mods: {}, resourcepacks: {}, shaders: {} };
  let modInfoCache = {};

  // --- Автоматическая установка фильтров из параметров запуска ---
  let launchVersion = null;
  let launchLoader = null;
  // filtersLocked будет управлять только видимостью групп версий/лоадеров и блокировкой их выбора.
  // Не будет влиять на сворачивание всей колонки фильтров.
  let filtersLocked = false;

  function getLaunchParams() {
    if (window.eel && eel.get_launch_params) {
      eel.get_launch_params()((params) => {
        console.log("Launch params received:", params);
        if (params.version) launchVersion = params.version;
        if (params.loader) launchLoader = params.loader;
        applyLaunchFilters();
      }).catch(e => console.error("Error getting launch params:", e));
    } else {
      console.log("Eel not available or get_launch_params not exposed.");
      const urlParams = new URLSearchParams(window.location.search);
      if (urlParams.has('version')) launchVersion = urlParams.get('version');
      if (urlParams.has('loader')) launchLoader = urlParams.get('loader');
      applyLaunchFilters();
    }
  }

  function applyLaunchFilters() {
    // Сначала очищаем, чтобы не было дублирования при повторных вызовах (например, при смене content type)
    selectedVersions = [];
    selectedLoaders = [];

    if (launchVersion) {
      selectedVersions.push(launchVersion);
      // Активируем кнопку только после того, как она будет отрендерена в renderVersionButtons
      // (вызывается из loadVersions, которая вызывается в init)
      // Вместо setTimeout, лучше положиться на то, что renderVersionButtons вызывается позже.
    }

    if (launchLoader && currentContentType === 'mod') {
      selectedLoaders.push(launchLoader);
      // Аналогично, активация кнопки будет позже.
    }

    const versionGroup = document.querySelector('.filter-group.version-block');
    const modloaderGroup = document.querySelector('.filter-group.modloader-block');

    if (launchVersion && launchLoader && currentContentType === 'mod') {
      filtersLocked = true; // Теперь это просто флаг блокировки выбора
      if (versionGroup) versionGroup.style.display = 'none';
      if (modloaderGroup) modloaderGroup.style.display = 'none';
      console.log("Filters locked due to launch params.");
    } else {
      filtersLocked = false; // Отменяем блокировку, если параметры запуска не применимы
      if (versionGroup) versionGroup.style.display = '';
      if (modloaderGroup && currentContentType === 'mod') modloaderGroup.style.display = ''; // Показывать, только если это мод
      else if (modloaderGroup) modloaderGroup.style.display = 'none'; // Скрывать для других типов контента
      console.log("Filters unlocked.");
    }
    // doSearch() вызывается здесь, но в init() мы уберем дублирующий вызов
    doSearch();
  }

  // --- Скрытие фильтра модлоадеров для shader/resourcepack ---
  function updateContentType() {
    searchInput.placeholder = `Поиск ${getContentTypeName()}...`;
    currentPage = 1;
    // Сбрасываем выбранные лоадеры при смене типа контента
    selectedLoaders = [];

    const modloaderGroup = document.querySelector('.filter-group.modloader-block');
    const versionGroup = document.querySelector('.filter-group.version-block');

    // Если тип контента - шейдеры или ресурспаки, скрываем модлоадеры и разблокируем версии
    if (currentContentType === 'shader' || currentContentType === 'resourcepack') {
      if (modloaderGroup) modloaderGroup.style.display = 'none';
      filtersLocked = false; // Разблокируем фильтры, так как лоадер не нужен
      if (versionGroup) versionGroup.style.display = ''; // Показываем версию
    } else { // Если это моды
      if (modloaderGroup) modloaderGroup.style.display = ''; // Показываем модлоадеры

      // Если есть заблокированные параметры запуска для модов, снова скрываем и блокируем
      if (launchVersion && launchLoader) {
        filtersLocked = true;
        if (versionGroup) versionGroup.style.display = 'none';
        if (modloaderGroup) modloaderGroup.style.display = 'none';
      } else {
        filtersLocked = false; // Нет блокировки, если нет параметров запуска
        if (versionGroup) versionGroup.style.display = '';
      }
    }
    doSearch();
  }

  function getContentTypeName() {
    switch(currentContentType) {
      case 'resourcepack': return 'текстур';
      case 'shader': return 'шейдеров';
      default: return 'модов';
    }
  }

  async function loadInstalledFiles() {
    try {
      console.log("Загрузка информации об установленных файлах...");
      // Здесь предполагается, что eel.get_installed_hashes() асинхронна и возвращает промис
      const hashes = await eel.get_installed_hashes()();
      installedHashes = hashes;

      const allHashes = new Set();
      Object.values(hashes).forEach(packType => {
        Object.keys(packType).forEach(hash => allHashes.add(hash));
      });

      if (allHashes.size > 0) {
        console.log(`Запрос информации для ${allHashes.size} хешей...`);
        // Здесь предполагается, что eel.get_mod_info() асинхронна и возвращает промис
        const info = await eel.get_mod_info(Array.from(allHashes))();
        modInfoCache = info;
        console.log('Информация о файлах получена', modInfoCache);
      } else {
        console.log("Установленные файлы не обнаружены");
        modInfoCache = {};
      }
    } catch (e) {
      console.error('Ошибка загрузки информации о файлов:', e);
      installedHashes = { mods: {}, resourcepacks: {}, shaders: {} };
      modInfoCache = {};
    }
  }

  function getProjectInfoByHash(hash) {
    return modInfoCache[hash] || null;
  }

  function compareVersions(a, b) {
    a = a.replace(/^[vV][\.-]?/, '').replace(/^release-/, '').split('+')[0].replace(/[^\d.]/g, '');
    b = b.replace(/^[vV][\.-]?/, '').replace(/^release-/, '').split('+')[0].replace(/[^\d.]/g, '');

    const pa = a.split('.').map(Number);
    const pb = b.split('.').map(Number);

    for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
      const na = pa[i] || 0;
      const nb = pb[i] || 0;
      if (na < nb) return -1;
      if (na > nb) return 1;
    }
    return 0;
  }

  async function getLatestModrinthFileVersion(projectId) {
    try {
      const versionsRes = await fetch(`https://api.modrinth.com/v2/project/${projectId}/version`);
      if (!versionsRes.ok) throw new Error(`Ошибка API Modrinth при получении версий для ${projectId}: ${versionsRes.status}`);
      const versions = await versionsRes.json();

      let wantedMcVersion = selectedVersions[0];
      let wantedLoader = selectedLoaders[0];

      // Если фильтры заблокированы параметрами запуска, используем их для поиска последней версии
      if (filtersLocked) {
          if (launchVersion) wantedMcVersion = launchVersion;
          if (launchLoader && currentContentType === 'mod') wantedLoader = launchLoader;
      }

      versions.sort((a, b) => new Date(b.date_published) - new Date(a.date_published));

      for (const v of versions) {
        const supportsMc = wantedMcVersion ? v.game_versions.includes(wantedMcVersion) : true;
        const supportsLoader = (currentContentType === 'mod' && wantedLoader) ? v.loaders.includes(wantedLoader) : true;

        if (!showSnapshots && (v.version_type === 'beta' || v.version_type === 'alpha')) {
            continue;
        }

        if (supportsMc && supportsLoader) {
          if (v.files && v.files.length > 0) {
            return {
                version_number: v.version_number,
                id: v.id
            };
          }
        }
      }
      return null;
    } catch (err) {
      console.error(`Ошибка при получении последней версии Modrinth для ${projectId}:`, err);
      return null;
    }
  }

  async function getInstalledStatus(projectId) {
      const packTypeKey = `${currentContentType}s`;
      const installedFilesForType = installedHashes[packTypeKey] || {};

      let installedModVersion = null;
      for (const [hash, filename] of Object.entries(installedFilesForType)) {
          const info = getProjectInfoByHash(hash);
          if (info && info.project_id === projectId) {
              installedModVersion = info.version || '0.0.0';
              break;
          }
      }

      if (!installedModVersion) {
          console.groupCollapsed(`[DEBUG] Проверка статуса для ${projectId}`);
          console.log(`  Тип контента: ${currentContentType}`);
          console.log(`  Проект не найден среди установленных файлов.`);
          console.log(`  Статус: INSTALL.`);
          console.groupEnd();
          return 'install';
      }

      const latestModrinthVersionInfo = await getLatestModrinthFileVersion(projectId);

      if (!latestModrinthVersionInfo) {
          console.groupCollapsed(`[DEBUG] Проверка статуса для ${projectId}`);
          console.log(`  Тип контента: ${currentContentType}`);
          console.log(`  Установленная версия (из кеша): "${installedModVersion}"`);
          console.log(`  Не удалось найти подходящую версию на Modrinth для текущих фильтров.`);
          console.log(`  Статус: INSTALLED (не можем определить, нужно ли обновление).`);
          console.groupEnd();
          return 'installed';
      }

      const latestModrinthVersion = latestModrinthVersionInfo.version_number;
      const comparisonResult = compareVersions(installedModVersion, latestModrinthVersion);

      console.groupCollapsed(`[DEBUG] Проверка статуса для ${projectId}`);
      console.log(`  Тип контента: ${currentContentType}`);
      console.log(`  Установленная версия (из кеша): "${installedModVersion}"`);
      console.log(`  Последняя версия из API (найденная по фильтрам): "${latestModrinthVersion}"`);
      console.log(`  Результат числового сравнения (installed vs latest): ${comparisonResult} (-1: installed < latest, 0: installed = latest, 1: installed > latest)`);

      if (comparisonResult < 0) {
          console.log(`  Статус: UPDATE (установленная версия ниже последней).`);
          console.groupEnd();
          return 'update';
      } else {
          console.log(`  Статус: INSTALLED (установленная версия такая же или новее).`);
          console.groupEnd();
          return 'installed';
      }
  }

  // Инициализация
  async function init() {
    showFullLoader();
    await loadInstalledFiles();
    setupEventListeners();
    await loadVersions(); // Загружаем версии перед получением параметров запуска, чтобы кнопки версий уже существовали
    // getLaunchParams() теперь вызывается здесь и вызывает applyLaunchFilters(), которая делает doSearch()
    getLaunchParams();

    // Здесь предполагается, что eel.get_installation_path() асинхронна и возвращает промис
    eel.get_installation_path()(path => {
      const pathInfo = document.createElement('div');
      pathInfo.className = 'path-info';
      pathInfo.innerHTML = `<i class="fas fa-folder-open"></i> Путь установки: ${path}`;
      document.querySelector('.container').prepend(pathInfo);
    }).catch(e => console.error("Error getting installation path:", e));

    setupExtraSettingsButton();
    // Убрал дублирующий doSearch(). Теперь он вызывается только из applyLaunchFilters() после получения launch params.
    // Это гарантирует, что первый поиск будет с учетом параметров запуска.
    // if (!launchVersion && !launchLoader) { doSearch(); } // Эту строку убрал
  }

  // Настройка обработчиков событий
  function setupEventListeners() {
    filtersHeader.addEventListener('click', () => {
      // Убрал if (filtersLocked) return;
      // Теперь заголовок всегда позволяет сворачивать/разворачивать колонку,
      // независимо от filtersLocked.
      const shown = filtersColumn.classList.toggle('show');
      filtersArrow.textContent = shown ? '▲' : '▼';

      if (shown) {
        filtersContent.style.display = 'block';
        setTimeout(() => {
          filtersContent.style.opacity = '1';
          filtersContent.style.transform = 'translateY(0)';
        }, 10);
      } else {
        filtersContent.style.opacity = '0';
        filtersContent.style.transform = 'translateY(-10px)';
        setTimeout(() => {
          filtersContent.style.display = 'none';
        }, 300);
      }
    });

    snapshotToggle.addEventListener('click', () => {
      snapshotToggle.classList.toggle('active');
      showSnapshots = snapshotToggle.classList.contains('active');
      renderVersionButtons();
      currentPage = 1;
      doSearch();
    });

    document.addEventListener('click', function(event) {
        const button = event.target.closest('.filter-button');
        // Пропускаем snapshotToggle и extra-settings-btn, так как у них своя логика
        if (button && button.id !== 'snapshot-toggle' && button.id !== 'extra-settings-btn') {
            const filterType = button.dataset.filter;
            const value = button.dataset.value;

            // Если фильтры заблокированы и это фильтр версии или лоадера,
            // И если кнопка уже активна (заблокированный фильтр), не даем её отключить.
            // И если она не активна, не даем её активировать, если она не соответствует launch-параметру.
            if (filtersLocked) {
                if (filterType === 'version') {
                    if (value === launchVersion) {
                        // Если это заблокированная кнопка версии, не даем ее деактивировать
                        if (button.classList.contains('active')) return;
                    } else {
                        // Если это НЕ заблокированная кнопка версии, не даем ее активировать
                        if (!button.classList.contains('active')) return;
                    }
                } else if (filterType === 'loader' && currentContentType === 'mod') {
                    if (value === launchLoader) {
                        // Если это заблокированная кнопка лоадера, не даем её деактивировать
                        if (button.classList.contains('active')) return;
                    } else {
                        // Если это НЕ заблокированная кнопка лоадера, не даем её активировать
                        if (!button.classList.contains('active')) return;
                    }
                }
                // Для других типов фильтров (категории, support, open source) блокировка не действует
            }

            button.classList.toggle('active');
            updateFilters();
        }
    });

    searchInput.addEventListener('input', () => {
      currentPage = 1;
      doSearch();
    });

    document.querySelectorAll('.content-type-btn').forEach(btn => {
      btn.addEventListener('click', function() {
        document.querySelectorAll('.content-type-btn').forEach(b => b.classList.remove('active'));
        this.classList.add('active');
        currentContentType = this.dataset.type;
        updateContentType();
      });
    });
  }

  function updateFilters() {
    selectedVersions = [];
    selectedLoaders = [];
    selectedCategories = [];
    selectedSupport = [];
    openSource = false;

    document.querySelectorAll('.filter-button.active').forEach(button => {
      const filterType = button.dataset.filter;
      const value = button.dataset.value;

      // Логика фильтров теперь не зависит от `filtersLocked` напрямую при *добавлении* в массивы.
      // `filtersLocked` теперь только влияет на то, какие кнопки можно кликать.
      if (filterType === 'version') selectedVersions.push(value);
      if (filterType === 'loader') selectedLoaders.push(value);
      if (filterType === 'category') selectedCategories.push(value);
      if (filterType === 'support') selectedSupport.push(value);
      if (filterType === 'source' && value === 'open') openSource = true;
    });

    // После сбора всех активных кнопок, если filtersLocked,
    // мы принудительно устанавливаем launchVersion/launchLoader, чтобы гарантировать их наличие.
    // Это на случай, если пользователь смог деактивировать их через баг или если они не были активны изначально.
    if (filtersLocked) {
        if (launchVersion && !selectedVersions.includes(launchVersion)) {
            selectedVersions = [launchVersion]; // Принудительно устанавливаем
        }
        if (launchLoader && currentContentType === 'mod' && !selectedLoaders.includes(launchLoader)) {
            selectedLoaders = [launchLoader]; // Принудительно устанавливаем
        }
    }


    currentPage = 1;
    doSearch();
  }

  const opts = [5, 10, 20, 50, 100];
  function buildPerPageBar() {
    perPageBar.innerHTML = opts.map(n =>
      `<span class="option${n === perPage ? ' selected' : ''}">${n}</span>`
    ).join('');
    perPageBar.querySelectorAll('.option').forEach(el => {
      el.addEventListener('click', () => {
        perPage = +el.textContent;
        currentPage = 1;
        buildPerPageBar();
        doSearch();
      });
    });
  }
  buildPerPageBar();

  async function loadVersions() {
    loader.style.display = 'block';
    try {
      const res = await fetch('https://launchermeta.mojang.com/mc/game/version_manifest_v2.json');
      const data = await res.json();
      allVersions = data.versions;
      renderVersionButtons();
    } catch (err) {
      console.error('Ошибка загрузки версий:', err);
      errorMessage.textContent = 'Не удалось загрузить версии.';
      errorMessage.style.display = 'block';
    } finally {
      loader.style.display = 'none';
    }
  }

  function renderVersionButtons() {
    const list = document.getElementById('version-list');
    list.innerHTML = '';

    const filteredVersions = allVersions.filter(v =>
      showSnapshots || v.type === 'release'
    );

    filteredVersions.sort((a, b) => compareVersions(b.id, a.id));

    const versionsToShow = filteredVersions.slice(0, 50);

    versionsToShow.forEach(v => {
      const button = document.createElement('div');
      button.className = 'filter-button';
      button.dataset.filter = 'version';
      button.dataset.value = v.id;

      if (v.type === 'snapshot') {
        button.innerHTML = `<i class="fas fa-cog yellow-icon"></i>${v.id}`;
      } else {
        button.textContent = v.id;
      }

      // Если версия выбрана или заблокирована параметрами запуска, делаем её активной
      if (selectedVersions.includes(v.id) || (filtersLocked && v.id === launchVersion)) {
        button.classList.add('active');
      }

      list.appendChild(button);
    });

    // Активируем кнопку лоадера, если она заблокирована параметрами запуска
    if (filtersLocked && launchLoader && currentContentType === 'mod') {
        setTimeout(() => { // Нужно дать DOM обновиться
            const loaderButton = document.querySelector(`.filter-group.modloader-block .filter-button[data-value="${launchLoader}"]`);
            if (loaderButton) {
                loaderButton.classList.add('active');
            }
        }, 50);
    }
  }

  // updateVersionSelection() не используется в вашем коде, его можно удалить или оставить.
  // function updateVersionSelection() {
  //   updateFilters();
  // }

  async function doSearch() {
    loader.style.display = 'block';
    modsContainer.innerHTML = '';
    errorMessage.style.display = 'none';
    paginationTop.style.display = paginationBot.style.display = 'none';

    const query = searchInput.value.trim();
    const offset = (currentPage - 1) * perPage;
    const facets = [];

    facets.push([`project_type:${currentContentType}`]);

    if (selectedVersions.length) facets.push(selectedVersions.map(v => 'versions:' + v));
    if (selectedLoaders.length && currentContentType === 'mod') facets.push(selectedLoaders.map(l => 'categories:' + l));
    if (selectedCategories.length) facets.push(selectedCategories.map(c => 'categories:' + c));
    if (selectedSupport.length) facets.push(selectedSupport.map(s => 'categories:' + s));
    if (openSource) facets.push(['open_source:true']);

    const params = new URLSearchParams({
      query,
      offset,
      limit: perPage,
      index: query ? 'relevance' : 'downloads',
      facets: JSON.stringify(facets)
    });

    try {
      const apiUrl = `https://api.modrinth.com/v2/search?${params}`;
      console.log("Запрос к API:", apiUrl);

      const res = await fetch(apiUrl);
      if (!res.ok) throw new Error(`HTTP error! status: ${res.status}`);

      const data = await res.json();
      console.log("Получены результаты поиска:", data.hits.length);
      await renderMods(data.hits);
      renderPagination(data.total_hits);
    } catch (err) {
      console.error('Ошибка поиска:', err);
      errorMessage.textContent = 'Ошибка поиска. Проверьте соединение с интернетом.';
      errorMessage.style.display = 'block';
    } finally {
      loader.style.display = 'none';
      if (currentPage === 1 && !searchInput.value.trim()) {
        hideFullLoader();
      } else if (currentPage === 1 && searchInput.value.trim()) {
          // Если это первый поиск (не пустой), также скрываем полный лоадер
          hideFullLoader();
      }
    }
  }

  async function renderMods(hits) {
    if (!hits.length) {
      modsContainer.innerHTML = '<div class="no-results">Ничего не найдено.</div>';
      return;
    }

    const seen = new Set();
    modsContainer.innerHTML = '';

    const modPromises = hits.map(async p => {
      if (seen.has(p.slug)) return null;
      seen.add(p.slug);

      const row = document.createElement('div');
      row.className = 'mod-row';
      row.dataset.id = p.project_id;

      const iconUrl = p.icon_url || 'https://cdn.modrinth.com/placeholder.svg';

      row.innerHTML = `
        <div class="mod-icon">
          <img src="${iconUrl}" onerror="this.src='https://cdn.modrinth.com/placeholder.svg'">
        </div>
        <div class="mod-info">
          <h3 class="mod-title">
            ${p.title}
            <span class="mod-author-inline">
              <img src='https://cravatar.eu/helmavatar/${p.author || "Steve"}/32.png'
                   style='width:24px;height:24px;border-radius:4px;margin-right:4px;vertical-align:middle;'
                   onerror="this.style.display='none'">
              ${p.author || 'Неизвестно'}
            </span>
          </h3>
          <p class="mod-description">${truncate(p.description, 200)}</p>
          <div class="mod-meta">
            <span><i class="fas fa-download"></i> ${p.downloads.toLocaleString('ru-RU')}</span>
          </div>
        </div>
        <div class="mod-actions">
          <button class="install-btn" data-id="${p.project_id}">Установить</button>
        </div>
      `;

      const btn = row.querySelector('.install-btn');
      const status = await getInstalledStatus(p.project_id);
      applyButtonStatus(btn, status, p);

      return row;
    });

    const renderedElements = await Promise.all(modPromises);
    renderedElements.forEach(element => {
      if (element) {
        modsContainer.appendChild(element);
      }
    });
  }

  function applyButtonStatus(btnElement, status, project = null) {
      btnElement.classList.remove('installed', 'update-btn', 'error', 'installing'); // Удаляем 'installing'
      btnElement.disabled = false;

      if (status === 'installed') {
          btnElement.textContent = 'Установлено';
          btnElement.disabled = true;
          btnElement.classList.add('installed');
          btnElement.onclick = null;
      } else if (status === 'update') {
          btnElement.textContent = 'Обновить';
          btnElement.classList.add('update-btn');
          if (project) btnElement.onclick = () => handleInstall(project, btnElement);
      } else {
          btnElement.textContent = 'Установить';
          if (project) btnElement.onclick = () => handleInstall(project, btnElement);
      }
  }

  function showPopup(message) {
    document.getElementById('popup-message').textContent = message;
    document.getElementById('popup-overlay').style.display = 'flex'; // Использовать flex для центрирования
    document.getElementById('popup-dialog').style.display = 'block';
  }
  function hidePopup() {
    document.getElementById('popup-overlay').style.display = 'none';
    document.getElementById('popup-dialog').style.display = 'none';
  }
  document.getElementById('popup-close').onclick = hidePopup;
  document.getElementById('popup-overlay').onclick = hidePopup;

  async function handleInstall(project, btn) {
    console.log("Начало обработки установки...");

    const installData = {
        project_id: project.project_id,
        slug: project.slug,
        project_type: project.project_type,
        title: project.title
    };

    let wantedMcVersion = selectedVersions[0];
    let wantedLoader = selectedLoaders[0];

    // Если фильтры заблокированы параметрами запуска, используем их для установки
    if (filtersLocked) {
        if (launchVersion) wantedMcVersion = launchVersion;
        if (launchLoader && currentContentType === 'mod') wantedLoader = launchLoader;
    }

    if (currentContentType === 'mod') {
      if (!wantedMcVersion || !wantedLoader) {
        showPopup('Пожалуйста, выберите версию Minecraft и модлоадер для установки мода.');
        return;
      }
    } else {
      if (!wantedMcVersion) {
        showPopup('Пожалуйста, выберите версию Minecraft для установки.');
        return;
      }
    }

    btn.disabled = true;
    btn.textContent = 'Проверка связи...';
    btn.classList.add('installing');
    btn.classList.remove('error', 'update-btn', 'installed');

    try {
        const versionsRes = await fetch(`https://api.modrinth.com/v2/project/${project.project_id}/version`);
        if (!versionsRes.ok) throw new Error(`Ошибка API Modrinth при получении версий: ${versionsRes.status}`);
        const versions = await versionsRes.json();

        versions.sort((a, b) => new Date(b.date_published) - new Date(a.date_published));

        let foundVersionForInstall = null;
        for (const v of versions) {
            const supportsMc = wantedMcVersion ? v.game_versions.includes(wantedMcVersion) : true;
            const supportsLoader = (currentContentType === 'mod' && wantedLoader) ? v.loaders.includes(wantedLoader) : true;

            if (!showSnapshots && (v.version_type === 'beta' || v.version_type === 'alpha')) {
                continue;
            }

            if (supportsMc && supportsLoader) {
                if (v.files && v.files.length > 0) {
                    foundVersionForInstall = v;
                    break;
                }
            }
        }

        if (!foundVersionForInstall) {
            btn.textContent = 'Нет подходящей версии';
            btn.classList.add('error');
            setTimeout(async () => {
                const updatedStatus = await getInstalledStatus(project.project_id);
                applyButtonStatus(btn, updatedStatus, project);
            }, 2000);
            return;
        }
        installData.version_id = foundVersionForInstall.id;
        btn.textContent = 'Установка...';

        // Здесь предполагается, что eel.test_connection() асинхронна и возвращает промис
        await eel.test_connection()();

        // Здесь предполагается, что eel.download_and_install() асинхронна и возвращает промис
        const result = await eel.download_and_install(
            installData.project_id,
            installData.slug,
            installData.project_type,
            installData.version_id,
            installData.title
        )();

        btn.classList.remove('installing');

        if (result && result.status === 'success') {
            await loadInstalledFiles();
            const updatedStatus = await getInstalledStatus(project.project_id);
            applyButtonStatus(btn, updatedStatus, project);
        } else {
            const errorMsg = result?.message || 'Неизвестная ошибка';
            console.error("Ошибка установки:", errorMsg);
            btn.textContent = 'Ошибка!';
            btn.classList.add('error');
            setTimeout(async () => {
                await loadInstalledFiles();
                const updatedStatus = await getInstalledStatus(project.project_id);
                applyButtonStatus(btn, updatedStatus, project);
            }, 2000);
        }
    } catch (err) {
        console.error("Общая ошибка в handleInstall:", err);
        btn.textContent = 'Ошибка!';
        btn.classList.add('error');
        setTimeout(async () => {
            await loadInstalledFiles();
            const updatedStatus = await getInstalledStatus(project.project_id);
            applyButtonStatus(btn, updatedStatus, project);
        }, 2000);
    }
}

  function renderPagination(total) {
    [paginationTop, paginationBot].forEach(pg => pg.innerHTML = '');
    const pages = Math.ceil(total / perPage);
    if (pages <= 1) return;

    [paginationTop, paginationBot].forEach(pg => {
      pg.style.display = 'flex';

      const prev = document.createElement('button');
      prev.textContent = '<';
      prev.disabled = currentPage === 1;
      prev.onclick = () => {
        if (currentPage > 1) {
          currentPage--;
          doSearch();
        }
      };
      pg.appendChild(prev);

      let arr;
      if (pages <= 5) {
        arr = Array.from({ length: pages }, (_, i) => i + 1);
      } else if (currentPage <= 3) {
        arr = [1, 2, 3, '...', pages];
      } else if (currentPage >= pages - 2) {
        arr = [1, '...', pages - 2, pages - 1, pages];
      } else {
        arr = [1, '...', currentPage - 1, currentPage, currentPage + 1, '...', pages];
      }

      arr.forEach(p => {
        if (p === '...') {
          const span = document.createElement('span');
          span.textContent = '...';
          span.className = 'ellipsis';
          pg.appendChild(span);
        } else {
          const btn = document.createElement('button');
          btn.textContent = p;
          btn.disabled = p === currentPage;
          btn.classList.toggle('active', p === currentPage);
          btn.onclick = () => {
            currentPage = p;
            doSearch();
          };
          pg.appendChild(btn);
        }
      });

      const next = document.createElement('button');
      next.textContent = '>';
      next.disabled = currentPage === pages;
      next.onclick = () => {
        if (currentPage < pages) {
          currentPage++;
          doSearch();
        }
      };
      pg.appendChild(next);
    });
  }

  function truncate(s, n) {
    return s && s.length > n ? s.slice(0, n) + '…' : (s || '');
  }

  function setupExtraSettingsButton() {
    const versionGroup = document.querySelector('.filter-group.version-block');
    const modloaderGroup = document.querySelector('.filter-group.modloader-block');
    let btn = document.getElementById('extra-settings-btn');
    if (!btn) {
      btn = document.createElement('button');
      btn.id = 'extra-settings-btn';
      btn.textContent = 'Доп. настройки';
      btn.classList.add('filter-button', 'extra-settings-button');
      document.querySelector('.filters-column').appendChild(btn);
    }
    // Обработчик клика для кнопки "Доп. настройки"
    btn.onclick = () => {
        // Переключаем состояние filtersLocked
        filtersLocked = !filtersLocked;
        // Переключаем видимость групп версий и модлоадеров
        if (versionGroup) versionGroup.style.display = filtersLocked ? 'none' : '';
        // Модлоадеры скрываем только если filtersLocked ИЛИ если текущий тип контента не 'mod'
        if (modloaderGroup) modloaderGroup.style.display = (filtersLocked || currentContentType !== 'mod') ? 'none' : '';

        // Дополнительно обновляем состояние кнопок фильтров, чтобы они отражали блокировку
        // без вызова doSearch(), так как doSearch() будет вызвана updateFilters()
        updateFilters(); // Это обновит selectedVersions/Loaders и вызовет doSearch()

        // Кнопка "Доп. настройки" будет отражать, скрыты ли фильтры
        btn.classList.toggle('active', filtersLocked);

        // НЕ переключаем filtersColumn.classList.toggle('show') здесь!
        // Эта кнопка управляет только видимостью групп внутри фильтров, а не всей колонки.
        // FiltersArrow и filtersColumn.classList.toggle('show') управляются только filtersHeader.
    };
    // Инициализируем состояние кнопки и видимость групп при загрузке
    // Это нужно, чтобы кнопка Доп. настроек была активна/неактивна в зависимости от initial filtersLocked
    btn.classList.toggle('active', filtersLocked);
    if (versionGroup) versionGroup.style.display = filtersLocked ? 'none' : '';
    if (modloaderGroup) modloaderGroup.style.display = (filtersLocked || currentContentType !== 'mod') ? 'none' : '';
  }

  function showFullLoader() {
    let loader = document.getElementById('full-loader');
    if (!loader) {
      loader = document.createElement('div');
      loader.id = 'full-loader';
      loader.innerHTML = '<div style="display:flex;flex-direction:column;align-items:center;gap:18px;"><div class="loader" style="display:block;width:80px;height:80px;border:10px solid #e0e0e0;border-top:10px solid var(--primary);border-radius:50%;animation:spin 1.2s linear infinite;"></div><div style="font-size:1.2rem;color:var(--primary);">Загрузка интерфейса...</div></div>';
      document.body.appendChild(loader);
    }
    loader.style.display = 'flex';
    loader.classList.remove('hidden');
  }
  function hideFullLoader() {
    const loader = document.getElementById('full-loader');
    if (loader) {
      loader.classList.add('hidden');
      setTimeout(() => {
        loader.style.display = 'none';
      }, 400);
    }
  }

  init();
});