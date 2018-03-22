'use strict';

{ // Private namespace starts.

  const mandatory = window.utils.mandatory;
  const throwIfError = window.utils.throwIfError;
  const chromified = window.utils.chromified;
  const timeouted = window.utils.timeouted;

  const kitchenStartsMark = '\n\n//%#@@@@@@ PAC_KITCHEN_STARTS @@@@@@#%';
  const kitchenState = window.utils.createStorage('pac-kitchen-');
  const ifIncontinence = 'if-incontinence';
  const modsKey = 'mods';

  let proxyHostToCredsList = {};
  const ifAuthSupported = chrome.webRequest && chrome.webRequest.onAuthRequired && !window.apis.version.ifMini;
  if (ifAuthSupported) {

    const requestIdToTries = {};

    chrome.webRequest.onAuthRequired.addListener(
      (details) => {

        if (!details.isProxy) {
          return {};
        }

        const proxyHost = `${details.challenger.host}:${details.challenger.port}`;
        const credsList = proxyHostToCredsList[proxyHost];
        if (!credsList) {
          return {}; // No creds found for this proxy.
        }
        const requestId = details.requestId;
        const tries = requestIdToTries[requestId] || 0;
        if (tries > credsList.length) {
          return {}; // All creds for this proxy were tried already.
        }
        requestIdToTries[requestId] = tries + 1;
        return {
          authCredentials: credsList[tries],
        };

      },
      {urls: ['<all_urls>']},
      ['blocking'],
    );

    const forgetRequestId = (details) => {

      delete requestIdToTries[details.requestId];

    };

    chrome.webRequest.onCompleted.addListener(
      forgetRequestId,
      {urls: ['<all_urls>']},
    );

    chrome.webRequest.onErrorOccurred.addListener(
      forgetRequestId,
      {urls: ['<all_urls>']},
    );

  }

  const getDefaultConfigs = () => ({// Configs user may mutate them and we don't care!

    ifProxyHttpsUrlsOnly: {
      dflt: false,
      label: 'проксировать только HTTP<em>S</em>-сайты',
      desc: 'Проксировать только сайты, доступные по шифрованному протоколу HTTP<em>S</em>. Прокси и провайдер смогут видеть только адреса проксируемых HTTP<em>S</em>-сайтов, но не их содержимое. Используйте, если вы не доверяете прокси-серверам ваш HTTP-трафик. Разумеется, что с этой опцией разблокировка HTTP-сайтов работать не будет.',
      order: 0,
    },
    ifUseSecureProxiesOnly: {
      dflt: false,
      label: 'только шифрованная связь с прокси',
      desc: 'Шифровать соединение до прокси от провайдера, используя только прокси типа HTTPS или локальный Tor. Провайдер всё же сможет видеть адреса (но не содержимое) проксируемых ресурсов из протокола DNS (даже с Tor). Опция вряд ли может быть вам полезна, т.к. шифруется не весь трафик, а лишь разблокируемые ресурсы.',
      order: 1,
    },
    ifProhibitDns: {
      dflt: false,
      label: 'запретить опредление по IP/DNS',
      desc: 'Пытается запретить скрипту использовать DNS, без которого определение блокировки по IP работать не будет (т.е. будет разблокироваться меньше сайтов). Используйте, чтобы получить прирост в производительности или если вам кажется, что мы проксируем слишком много сайтов. Запрет действует только для скрипта, браузер и др.программы продолжат использование DNS.',
      order: 2,
    },
    ifProxyOrDie: {
      dflt: true,
      ifDfltMods: true,
      label: 'проксируй или умри!',
      desc: 'Запрещает соединение с сайтами напрямую без прокси в случаях, когда все прокси отказывают. Например, если все ВАШИ прокси вдруг недоступны, то добавленные вручную сайты открываться не будут совсем. Однако смысл опции в том, что она препятствует занесению прокси в чёрные списки Хрома. Рекомендуется не отключать.',
      order: 3,
    },
    ifUsePacScriptProxies: {
      dflt: true,
      category: 'ownProxies',
      label: 'использовать прокси PAC-скрипта',
      desc: 'Использовать прокси-сервера от авторов PAC-скрипта.',
      order: 4,
    },
    ifUseLocalTor: {
      dflt: false,
      category: 'ownProxies',
      label: 'использовать СВОЙ локальный Tor',
      desc: 'Установите <a href="https://www.torproject.org/">Tor</a> на свой компьютер и используйте его как прокси-сервер. <a href="https://www.torproject.org/">ВАЖНО</a>',
      order: 5,
    },
    exceptions: {
      category: 'exceptions',
      dflt: null,
    },
    ifMindExceptions: {
      dflt: true,
      category: 'exceptions',
      label: 'учитывать исключения',
      desc: 'Учитывать сайты, добавленные вручную. Только для своих прокси-серверов! Без своих прокси работать не будет.',
      order: 6,
    },
    customProxyStringRaw: {
      dflt: '',
      category: 'ownProxies',
      label: 'использовать СВОИ прокси',
      //url: 'https://rebrand.ly/ac-own-proxy',
      order: 7,
    },
    ifProxyMoreDomains: {
      ifDisabled: true,
      dflt: false,
      category: 'ownProxies',
      label: 'проксировать .onion, .i2p и <a href="https://en.wikipedia.org/wiki/OpenNIC#OpenNIC_TLDs">OpenNIC</a>',
      desc: 'Проксировать особые домены. Необходима поддержка со стороны СВОИХ прокси.',
      order: 8,
    },

  });

  const getDefaults = function getDefaults() {

    const configs = getDefaultConfigs();
    return Object.keys(configs).reduce((acc, key) => {

      acc[key] = configs[key].dflt;
      return acc;

    }, {});

  };

  const getCurrentConfigs = function getCurrentConfigs(ifRaw = false) {

    const oldMods = kitchenState(modsKey);
    if (ifRaw) {
      // No migration!
      return oldMods;
    }

    // Client may expect mods.included and mods.excluded!
    // On first install they are not defined.
    const [err, mods, ...warns] = createPacModifiers(oldMods);
    if (err) {
      throw err;
    }
    return mods;

  };

  const getOrderedConfigsForUser = function getOrderedConfigs(category) {

    const pacMods = getCurrentConfigs();
    const configs = getDefaultConfigs();
    return Object.keys(configs)
      .sort((keyA, keyB) => configs[keyA].order - configs[keyB].order)
      .reduce((arr, key) => {

        const conf = configs[key];
        if(typeof(conf.order) === 'number') {
          if(!category || category === (conf.category || 'general')) {
            conf.value = pacMods[key];
            conf.key = key;
            conf.category = category || 'general';
            arr.push(conf);
         }
        }
        return arr;

      }, []);

  };

  const createPacModifiers = function createPacModifiers(mods = {}) {

    mods = mods || {}; // null?
    const configs = getDefaultConfigs();
    const ifNoMods = Object.keys(configs)
      .every((dProp) => {

        const ifDflt = (
          !(
            dProp in mods &&
            Boolean(configs[dProp].dflt) !== Boolean(mods[dProp])
          )
        );
        const ifMods = configs[dProp].ifDfltMods; // If default value implies PAC-script modification.
        return ifDflt ? !ifMods : ifMods;

      });

    const self = {};
    Object.assign(self, getDefaults(), mods);
    self.ifNoMods = ifNoMods;

    let customProxyArray = [];
    if (self.customProxyStringRaw) {
      customProxyArray = self.customProxyStringRaw
        .replace(/#.*$/mg, '') // Strip comments.
        .split( /(?:\s*(?:;\r?\n)+\s*)+/g )
        .map( (p) => p.trim() )
        .filter( (p) => p && /\s+/g.test(p) ); // At least one space is required.
      if (self.ifUseSecureProxiesOnly) {
        customProxyArray = customProxyArray.filter( (pStr) => /^HTTPS\s/.test(pStr) );
      }
    }
    if (self.ifUseLocalTor) {
      self.torPoints = ['SOCKS5 localhost:9150', 'SOCKS5 localhost:9050'];
      customProxyArray.push(...self.torPoints);
    }

    // Hanlde protected proxies in customProxyArray.
    const protectedProxies = [];
    customProxyArray = customProxyArray.map((proxyScheme) => {

      if (proxyScheme.includes('@')) {

        const proxy = window.utils.parseProxyScheme(proxyScheme);
        protectedProxies.push(proxy);
        return `${proxy.type} ${proxy.hostname}:${proxy.port}`;

      }
      return proxyScheme;

    });

    if (!ifAuthSupported && protectedProxies.length) {
      return [new Error('Запароленные прокси не поддерживатюся в данной версии/платформе!')];
    }

    proxyHostToCredsList = {};
    protectedProxies.forEach(({ hostname, port, username, password }) => {

      proxyHostToCredsList[`${hostname}:${port}`] =
        proxyHostToCredsList[`${hostname}:${port}`] || [];
      const tries = proxyHostToCredsList[`${hostname}:${port}`];
      tries.push({
        username: username || '',
        password: password || '',
      });

    });

    self.filteredCustomsString = '';
    if (customProxyArray.length) {
      self.customProxyArray = customProxyArray;
      self.filteredCustomsString = customProxyArray.join('; ');
    } else {
      if (!self.ifUsePacScriptProxies) {
        return [new TypeError('Нет ни одного прокси, удовлетворяющего вашим требованиям!')];
      }
      self.customProxyArray = false;
    }

    [self.included, self.excluded] = [[], []];
    if (self.ifProxyMoreDomains) {
      self.moreDomains = [
        /* Networks */
        'onion', 'i2p',
        /* OpenNIC */
        'bbs', 'chan', 'dyn', 'free', 'geek', 'gopher', 'indy',
        'libre', 'neo', 'null', 'o', 'oss', 'oz', 'parody', 'pirate',
        /* OpenNIC Alternatives */
        'bazar', 'bit', 'coin', 'emc', 'fur', 'ku', 'lib', 'te', 'ti', 'uu'
      ];
    }
    if (self.ifMindExceptions && self.exceptions) {
      self.included = [];
      self.excluded = [];
      for(const host of Object.keys(self.exceptions)) {
        if (self.exceptions[host]) {
          self.included.push(host);
        } else {
          self.excluded.push(host);
        }
      }
      ['included', 'excluded'].forEach((who) => {

        self[who] = self[who]
          .map( (s) => s.split('').reverse() )
          .sort()
          .map( (a) => a.reverse().join('') );

      });
      if (self.included.length && !self.filteredCustomsString) {
        return [null, self, new TypeError(
          'Имеются сайты, добавленные вручную. Они проксироваться не будут, т.к. нет СВОИХ проски, удовлетворяющих вашим требованиям! Если прокси всё же имеются, то проверьте требования (модификаторы).'
        )];
      }
    }
    return [null, self];

  };

  window.apis.pacKitchen = {

    getPacMods: getCurrentConfigs,
    getPacModsRaw: () => getCurrentConfigs(true),
    getOrderedConfigs: getOrderedConfigsForUser,

    cook(pacData, pacMods = mandatory()) {

      pacData = pacData.replace(
        new RegExp(kitchenStartsMark + '[\\s\\S]*$', 'g'),
        ''
      );
      /a/.test('a'); // GC RegExp.input and friends.

      return pacMods.ifNoMods ? pacData : pacData + `${ kitchenStartsMark }
/******/
/******/;(function(global) {
/******/  "use strict";
/******/
/******/  const originalFindProxyForURL = FindProxyForURL;
/******/  const tmp = function(url, host) {
/******/
    ${
      function() {

        let res = pacMods.ifProhibitDns ? `
/******/
/******/    global.dnsResolve = function(host) { return null; };
/******/
/******/` : '';
        if (pacMods.ifProxyHttpsUrlsOnly) {

          res += `
/******/
/******/    if (!url.startsWith("https")) {
/******/      return "DIRECT";
/******/    }
/******/
/******/  `;
        }
        if (pacMods.ifUseLocalTor) {

          res += `
/******/
/******/    if (host.endsWith(".onion")) {
/******/      return "${pacMods.torPoints.join('; ')}";
/******/    }
/******/
/******/  `;
        }
        res += `
/******/
/******/    const directIfAllowed = ${pacMods.ifProxyOrDie ? '""/* Not allowed. */' : '"; DIRECT"'};
/******/`;
        if (pacMods.filteredCustomsString) {
          res += `
/******/
/******/    const filteredCustomProxies = "; ${pacMods.filteredCustomsString}";
/******/`;
        }

        const ifIncluded = pacMods.included && pacMods.included.length;
        const ifExcluded = pacMods.excluded && pacMods.excluded.length;
        const ifManualExceptions = ifIncluded || ifExcluded;
        const finalExceptions = {};
        if (pacMods.ifProxyMoreDomains) {
          pacMods.moreDomains.reduce((acc, tld) => {

            acc[tld] = true;
            return acc;

          }, finalExceptions);
        }
        if (pacMods.ifMindExceptions) {
          Object.assign(finalExceptions, (pacMods.exceptions || {}));
        }
        const ifExceptions = Object.keys(finalExceptions).length;

        if (ifExceptions) {
          res += `
/******/
/******/    /* EXCEPTIONS START */
/******/    const dotHost = '.' + host;
/******/    const isHostInDomain = (domain) => dotHost.endsWith('.' + domain);
/******/    const domainReducer = (maxWeight, [domain, ifIncluded]) => {
/******/
/******/      if (!isHostInDomain(domain)) {
/******/        return maxWeight;
/******/      }
/******/      const newWeightAbs = domain.length;
/******/      if (newWeightAbs < Math.abs(maxWeight)) {
/******/        return maxWeight;
/******/      }
/******/      return newWeightAbs*(ifIncluded ? 1 : -1);
/******/
/******/    };
/******/
/******/    const excWeight = ${ JSON.stringify(Object.entries(finalExceptions)) }.reduce( domainReducer, 0 );
/******/    if (excWeight !== 0) {
/******/      if (excWeight < 0) {
/******/        // Never proxy it!
/******/        return "DIRECT";
/******/      }
/******/      // Always proxy it!
${        pacMods.filteredCustomsString
            ? `/******/      return filteredCustomProxies + directIfAllowed;`
            : '/******/      /* No custom proxies -- continue. */'
}
/******/    }
/******/    /* EXCEPTIONS END */
`;
        }
        res += `
/******/    const pacScriptProxies = originalFindProxyForURL(url, host)${
/******/          pacMods.ifProxyOrDie ? '.replace(/DIRECT/g, "")' : ' + directIfAllowed'
        };`;
        if(
          !pacMods.ifUseSecureProxiesOnly &&
          !pacMods.filteredCustomsString &&
           pacMods.ifUsePacScriptProxies
        ) {
          return res + `
/******/    return (pacScriptProxies + directIfAllowed) || "DIRECT";`;
        }

        return res + `
/******/    let pacProxyArray = pacScriptProxies.split(/(?:\\s*;\\s*)+/g).filter( (p) => p );
/******/    const ifNoProxies = pacProxyArray${pacMods.ifProxyOrDie ? '.length === 0' : '.every( (p) => /^DIRECT$/i.test(p) )'};
/******/    if (ifNoProxies) {
/******/      // Directs only or null, no proxies.
/******/      return "DIRECT";
/******/    }
/******/    return ` +
        function() {

          if (!pacMods.ifUsePacScriptProxies) {
            return '';
          }
          let filteredPacExp = 'pacScriptProxies';
          if (pacMods.ifUseSecureProxiesOnly) {
            filteredPacExp =
              'pacProxyArray.filter( (pStr) => /^HTTPS\\s/.test(pStr) ).join("; ")';
          }
          return filteredPacExp + ' + ';

        }() + `${pacMods.filteredCustomsString ? 'filteredCustomProxies + ' : ''}directIfAllowed;`; // Without DIRECT you will get 'PROXY CONN FAILED' pac-error.

      }()
    }

/******/  };

/******/  if (global) {
/******/    global.FindProxyForURL = tmp;
/******/  } else {
/******/    FindProxyForURL = tmp;
/******/  }

/*****/})(this);`;

    },

    setNowAsync(details, cb = throwIfError) {

      if (typeof(details) === 'function') {
        cb = details;
        details = undefined;
      }

      new Promise((resolve) =>

        details
          ? resolve(details)
          : chrome.proxy.settings.get({}, timeouted(resolve) ),

      ).then((details) => {

        if (
          details && details.levelOfControl === 'controlled_by_this_extension'
        ) {
          const pac = window.utils.getProp(details, 'value.pacScript');
          if (pac && pac.data) {
            return chrome.proxy.settings.set(details, chromified(cb));
          }
        }

        kitchenState(ifIncontinence, true);
        cb(null, null, new TypeError(
          'Не найдено активного PAC-скрипта! Изменения будут применены при возвращении контроля настроек прокси или установке нового PAC-скрипта.'
        ));

      });

    },

    checkIncontinence(details) {

      if ( kitchenState(ifIncontinence) ) {
        this.setNowAsync(details, () => {/* Swallow. */});
      }

    },

    keepCookedNowAsync(pacMods = mandatory(), cb = throwIfError) {

      let ifProxiesChanged = false;
      let modsWarns = [];
      if (typeof(pacMods) === 'function') {
        cb = pacMods;
        pacMods = getCurrentConfigs();
      } else {
        let modsErr;
        [modsErr, pacMods, ...modsWarns] = createPacModifiers(pacMods);
        if (modsErr) {
          return cb(modsErr, null, modsWarns);
        }
        const oldProxies = getCurrentConfigs().filteredCustomsString || '';
        const newProxies = pacMods.filteredCustomsString || '';
        ifProxiesChanged = oldProxies !== newProxies;
        kitchenState(modsKey, pacMods);
      }
      this.setNowAsync(
        (err, res, ...setWarns) => {

          const accWarns = modsWarns.concat(setWarns); // Acc = accumulated.
          if (err) {
            return cb(err, res, ...accWarns);
          }

          if (!ifProxiesChanged) {
            return cb(null, res, ...accWarns);
          }
          const newHosts = (pacMods.customProxyArray || []).map( (ps) => ps.split(/\s+/)[1] );
          window.utils.fireRequest(
            'ip-to-host-replace-all',
            newHosts,
            (err, res, ...moreWarns) =>
              cb(err, res, ...accWarns, ...moreWarns),
          );

        },
      );

    },

    resetToDefaults() {

      kitchenState(modsKey, null);
      kitchenState(ifIncontinence, null);
      this.keepCookedNowAsync(throwIfError);

    },

  };

  const pacKitchen = window.apis.pacKitchen;

  const originalSet = chrome.proxy.settings.set.bind( chrome.proxy.settings );

  chrome.proxy.settings.set = function(details, cb) {

    const pac = window.utils.getProp(details, 'value.pacScript');
    if (!(pac && pac.data)) {
      return originalSet(details, cb);
    }
    const pacMods = getCurrentConfigs();
    pac.data = pacKitchen.cook( pac.data, pacMods );
    originalSet({value: details.value}, (/* No args. */) => {

      kitchenState(ifIncontinence, null);
      cb && cb();

    });

  };

  pacKitchen.checkIncontinence();
  chrome.proxy.settings.onChange.addListener(
    timeouted(
      pacKitchen.checkIncontinence.bind(pacKitchen)
    )
  );

} // Private namespace ends.
