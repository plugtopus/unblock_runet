'use strict';

{

  const IF_DEBUG = true;

  if (!IF_DEBUG) {
    // I believe logging objects precludes them from being GCed.
    // I also don't remove logs for sake of client-side troubleshooting
    // (though no one sent me logs so far).
    ['log', 'warn', 'error'].forEach( (meth) => {
      const _meth = window.console[meth].bind(console);
      window.console[meth] = function(...args) {

        _meth(...args.map((a) => '' + a));

      };
    });
  }

  const privates = {
    requestToResponder: {},
  };

  const self = window.utils = {

    mandatory() {

      throw new TypeError('Missing required argument. ' +
        'Be explicit if you swallow errors.');

    },

    throwIfError(err) {

      if(err) {
        throw err;
      }

    },

    checkChromeError() {

      // Chrome API calls your cb in a context different from the point of API
      // method invokation.
      const err = chrome.runtime.lastError || chrome.extension.lastError;
      if (!err) {
        return;
      }
      console.warn('API returned error:', err);
      return new Error(err.message); // Add stack.

    },

    timeouted(cb = self.mandatory) {

      // setTimeout fixes error context, see bug #357568.
      return (...args) => setTimeout(() => cb(...args), 0);

    },

    chromified(cb = self.mandatory()) {

      // Take error first callback and convert it to chrome API callback.
      return function(...args) {

        const err = self.checkChromeError();
        self.timeouted(cb)(err, ...args);

      };

    },

    getOrDie(cb = self.mandatory()) {

      return self.chromified((err, ...args) => {

        if (err) {
          throw err;
        }
        cb(...args);

      });

    },

    getProp(obj, path = self.mandatory()) {

      const props = path.split('.');
      if (!props.length) {
        throw new TypeError('Property must be supplied.');
      }
      const lastProp = props.pop();
      for( const prop of props ) {
        if (!(prop in obj)) {
          return undefined;
        }
        obj = obj[prop];
      }
      return obj[lastProp];

    },

    assert(value) {

      if(!value) {
        console.assert(value);
        throw new Error('Assert failed for:' + value);
      }

    },

    addRequestResponder(requestType, responder) {

      if( privates.requestToResponder[requestType] ) {
        throw new TypeError(`Request ${requestType} already has responder!`);
      }
      privates.requestToResponder[requestType] = responder;

    },

    fireRequest(requestType, ...args) {

      const cb = args.slice(-1)[0];
      self.assert(typeof(cb) === 'function');
      const responder = privates.requestToResponder[requestType];
      if(responder) {
        responder(...args);
      } else {
        cb();
      }

    },

    createStorage(prefix) {

      return function state(key, value) {

        key = prefix + key;
        if (value === null) {
          return window.localStorage.removeItem(key);
        }
        if (value === undefined) {
          const item = window.localStorage.getItem(key);
          return item && JSON.parse(item);
        }
        if (value instanceof Date) {
          throw new TypeError('Converting Date format to JSON is not supported.');
        }
        window.localStorage.setItem(key, JSON.stringify(value));

      };

    },

    /*
    * Possible values for levelOfControl:
    *
    * 1. "not_controllable"
    * 2. "controlled_by_other_extensions"
    * 3. "controllable_by_this_extension"
    * 4. "controlled_by_this_extension"
    *
    * See: https://developer.chrome.com/extensions/proxy
    * */


    areSettingsControllableFor(details) {

      return details.levelOfControl.endsWith('this_extension');

    },

    areSettingsControlledFor(details) {

      return details.levelOfControl.startsWith('controlled_by_this');

    },

    messages: {

      searchSettingsForUrl(niddle) {

        return 'chrome://settings/search#' + (chrome.i18n.getMessage(niddle) || niddle);

      },

      whichExtensionHtml() {

        return chrome.i18n.getMessage('noControl') +
          ` <a href="${ this.searchSettingsForUrl('proxy') }">
            ${ chrome.i18n.getMessage('which') }
          </a>`;

      },

    },

    parseProxyScheme(proxyAsStringRaw) {

      const proxyAsString = proxyAsStringRaw.trim();
      const [type] = proxyAsString.split(/\s+/);
      /*
      if (!/^[a-zA-Z0-9]+$/.test(type)) {
        throw new Error(`${type} is not a proxy type!`);
      }
        JS has no code blocks in RE, seems safe to omit this check.
      */
      const typeRe = new RegExp(`^${type}\\s+`, 'g');
      const crededAddr = proxyAsString.replace(typeRe, '');

      let parts;
      parts = crededAddr.split('@');
      let [creds, addr] = [parts.slice(0, -1).join('@'), parts[parts.length - 1]];

      const [hostname, port] = addr.split(':');

      parts = creds.split(':')
      const username = parts[0];
      const password = parts.slice(1).join(':');

      return {
        type,
        username,
        password,
        hostname,
        port,
        creds,
      }

    },

  };

  const max = 2**16;
  const versionToArray = (v) => [ ...v.split('.'), 0, 0, 0].slice(0,4);
  const versionToInt = (v) => versionToArray(v)
    .reverse()
    .reduce((acc, vv, i) => acc + parseInt(vv)*(max**i), 0);

  const compareVersions = (a, b) => versionToInt(a) - versionToInt(b);

  window.apis = {
    platform: {
      ifFirefox: navigator.userAgent.toLowerCase().includes('firefox'),
    },
    version: {
      ifMini: false,
      build: chrome.runtime.getManifest().version.replace(/\d+\.\d+\./g, ''),

      isLeq: (a, b) => compareVersions(a, b) <= 0,
    },
  };

  // Shims for FireFox

  if (!chrome.proxy.settings) {

    const ffxStore = window.utils.createStorage('firefox-only');


    chrome.proxy.settings = {
      get: (_, cb) => {

        let currentSettings = ffxStore('proxySettings') || {};
        currentSettings.levelOfControl = 'controlled_by_this_extension'; // May be lie, but this field is required.
        cb && cb(currentSettings);

      },
      onChange: {
        addListener: () => {},
      },
      set: (details, cb) => {

        browser.proxy.unregister();
        browser.proxy.register('./default.pac.js');


        // browser.proxy.onProxyError.addListener((...err) => { console.log('ERROR IN PAC:', ...err)  });

        browser.runtime.sendMessage(details, {toProxyScript: true});
        ffxStore('proxySettings', details);
        cb && cb();

      },
    };
    const proxySettings = ffxStore('proxySettings');
    if (proxySettings) {
      chrome.proxy.settings.set(proxySettings);
    }

  }

}
