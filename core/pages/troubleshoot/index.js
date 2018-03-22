'use strict';

chrome.runtime.getBackgroundPage( (backgroundPage) =>
  backgroundPage.apis.errorHandlers.installListenersOn(
    window, 'TRBL', () => {

      document.getElementById('reset-settings').onclick = () => {

        backgroundPage.localStorage.clear();
        chrome.storage.local.clear( () => chrome.runtime.reload() );
      };

    })
);
