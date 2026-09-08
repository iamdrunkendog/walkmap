import { rmSync, mkdirSync, cpSync, writeFileSync, readdirSync, readFileSync, existsSync } from 'node:fs';
import { resolve, dirname, extname, basename } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const dist = resolve(root, 'dist');
const pub = resolve(root, 'public');

console.log('Building static assets for GitHub Pages...');

// 1. Clean and recreate dist
rmSync(dist, { recursive: true, force: true });
mkdirSync(dist, { recursive: true });

// 2. Copy static files from public/
const publicFiles = ['index.html', 'style.css', 'app.mjs', 'model.mjs', 'firebase.mjs'];
for (const file of publicFiles) {
  const src = resolve(pub, file);
  if (existsSync(src)) {
    cpSync(src, resolve(dist, file));
  } else {
    throw new Error(`Required file missing: public/${file}`);
  }
}

// 3. Handle config.js: inject env vars if present, otherwise copy template
let firebaseConfig = {
  apiKey: process.env.FIREBASE_API_KEY || '',
  authDomain: process.env.FIREBASE_AUTH_DOMAIN || '',
  projectId: process.env.FIREBASE_PROJECT_ID || '',
  storageBucket: process.env.FIREBASE_STORAGE_BUCKET || '',
  messagingSenderId: process.env.FIREBASE_MESSAGING_SENDER_ID || '',
  appId: process.env.FIREBASE_APP_ID || '',
};

if (process.env.FIREBASE_CONFIG) {
  try {
    const parsed = typeof process.env.FIREBASE_CONFIG === 'string'
      ? JSON.parse(process.env.FIREBASE_CONFIG)
      : process.env.FIREBASE_CONFIG;
    firebaseConfig = { ...firebaseConfig, ...parsed };
  } catch (e) {
    console.warn('Could not parse FIREBASE_CONFIG JSON:', e.message);
  }
}

const mapsClientId = process.env.NAVER_MAPS_CLIENT_ID || '';
const functionsRegion = process.env.FIREBASE_FUNCTIONS_REGION || 'asia-northeast3';

const hasInjectedValues = Boolean(mapsClientId || firebaseConfig.projectId || firebaseConfig.apiKey);

if (hasInjectedValues) {
  const configContent = `// Generated during build at ${new Date().toISOString()}
export const config = {
  mapsClientId: ${JSON.stringify(mapsClientId)},
  firebase: ${JSON.stringify(firebaseConfig, null, 2)},
  functionsRegion: ${JSON.stringify(functionsRegion)},
  useEmulator: false
};
`;
  writeFileSync(resolve(dist, 'config.js'), configContent, 'utf8');
} else if (existsSync(resolve(pub, 'config.js'))) {
  cpSync(resolve(pub, 'config.js'), resolve(dist, 'config.js'));
}

// 4. Custom domain CNAME for walkmap.gaemi.kim
writeFileSync(resolve(dist, 'CNAME'), 'walkmap.gaemi.kim\n', 'utf8');

// 5. GitHub Pages SPA fallback: 404.html
cpSync(resolve(dist, 'index.html'), resolve(dist, '404.html'));

// 6. Security & static integrity verification
const allowedExtensions = new Set(['.html', '.css', '.js', '.mjs', '']);
const allowedFilenames = new Set(['CNAME', '.nojekyll']);

const distFiles = readdirSync(dist);
for (const file of distFiles) {
  const ext = extname(file);
  const name = basename(file);
  if (!allowedExtensions.has(ext) && !allowedFilenames.has(name)) {
    throw new Error(`Unexpected non-static file in dist: ${file}`);
  }
  if (file.includes('server') || file.includes('sqlite') || file.includes('.env')) {
    throw new Error(`Disallowed server/runtime file found in dist: ${file}`);
  }
}

console.log(`Build complete. Generated ${distFiles.length} static files in dist/:`);
for (const file of distFiles) {
  console.log(` - dist/${file}`);
}
