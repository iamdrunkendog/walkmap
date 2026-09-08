// WalkMap client configuration template.
// Values are injected during the GitHub Pages build or configured locally.
// Security note: Client config values are public in the browser bundle.
// Never put server secrets here.
export const config = {
  // NAVER Cloud Platform Application Client ID (Dynamic Map v3)
  mapsClientId: window.__WALKMAP_CONFIG__?.mapsClientId || '',

  // Firebase Web App Client Configuration
  firebase: {
    apiKey: window.__WALKMAP_CONFIG__?.firebase?.apiKey || '',
    authDomain: window.__WALKMAP_CONFIG__?.firebase?.authDomain || '',
    projectId: window.__WALKMAP_CONFIG__?.firebase?.projectId || '',
    storageBucket: window.__WALKMAP_CONFIG__?.firebase?.storageBucket || '',
    messagingSenderId: window.__WALKMAP_CONFIG__?.firebase?.messagingSenderId || '',
    appId: window.__WALKMAP_CONFIG__?.firebase?.appId || '',
  },

  // Region where Firebase Functions are deployed
  functionsRegion: window.__WALKMAP_CONFIG__?.functionsRegion || 'asia-northeast3',

  // Enable local emulator connection when true
  useEmulator: window.__WALKMAP_CONFIG__?.useEmulator || false,
};
