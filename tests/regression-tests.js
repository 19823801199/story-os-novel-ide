const fs = require('fs');
const vm = require('vm');

function mockEl(tag) {
  return {
    tagName: tag,
    classList: { add: () => {}, remove: () => {}, toggle: () => {}, contains: () => false },
    style: {},
    dataset: {},
    children: [],
    appendChild: () => {},
    removeChild: () => {},
    insertBefore: () => {},
    addEventListener: () => {},
    removeEventListener: () => {},
    setAttribute: () => {},
    getAttribute: () => null,
    removeAttribute: () => {},
    querySelector: () => mockEl('div'),
    querySelectorAll: () => [],
    getBoundingClientRect: () => ({ top: 0, left: 0, width: 0, height: 0 }),
    scrollIntoView: () => {},
    focus: () => {},
    click: () => {},
    innerHTML: '',
    textContent: '',
    value: '',
    selectedIndex: 0,
    checked: false,
    parentNode: null,
    nextSibling: null,
    previousSibling: null
  };
}

const context = {
  window: {},
  document: {
    getElementById: () => mockEl('div'),
    querySelector: () => mockEl('div'),
    querySelectorAll: () => [],
    createElement: (tag) => mockEl(tag),
    createDocumentFragment: () => mockEl('fragment'),
    createTextNode: (t) => ({ textContent: t }),
    body: mockEl('body'),
    head: mockEl('head'),
    documentElement: {
      setAttribute: () => {},
      removeAttribute: () => {},
      style: { setProperty: () => {} },
      classList: { add: () => {}, remove: () => {} }
    },
    addEventListener: () => {},
    removeEventListener: () => {},
    title: '',
    hidden: false
  },
  localStorage: {
    data: {},
    getItem(k) { return this.data[k] || null; },
    setItem(k, v) { this.data[k] = v; },
    removeItem(k) { delete this.data[k]; }
  },
  indexedDB: null,
  IDB: { save: () => Promise.resolve(), delete: () => Promise.resolve(), get: () => Promise.resolve(null) },
  EventBus: { on: () => {}, off: () => {}, emit: () => {}, listeners: {} },
  showToast: () => {},
  showConfirm: () => Promise.resolve(true),
  updateSaveStatus: () => {},
  checkStorageWarning: () => {},
  PerfMonitor: { start: () => {}, end: () => {} },
  DataState: { _dirty: false, _isSaving: false },
  STORAGE_KEY: 'novelcraft_unified_v1',
  OLD_STORAGE_KEY: 'novelcraft_pro_v1',
  structuredClone: (v) => JSON.parse(JSON.stringify(v)),
  requestAnimationFrame: (cb) => setTimeout(cb, 0),
  MutationObserver: class { observe() {} disconnect() {} },
  IntersectionObserver: class { observe() {} disconnect() {} },
  ResizeObserver: class { observe() {} disconnect() {} },
  navigator: { userAgent: '' },
  location: { href: '', hash: '' },
  history: { pushState: () => {}, replaceState: () => {} },
  setTimeout: setTimeout,
  clearTimeout: clearTimeout,
  setInterval: setInterval,
  clearInterval: clearInterval,
  console: console,
  JSON: JSON,
  Math: Math,
  Date: Date,
  Array: Array,
  Object: Object,
  String: String,
  Number: Number,
  Boolean: Boolean,
  RegExp: RegExp,
  Error: Error,
  TypeError: TypeError,
  ReferenceError: ReferenceError,
  SyntaxError: SyntaxError,
  RangeError: RangeError,
  Promise: Promise,
  parseInt: parseInt,
  parseFloat: parseFloat,
  isNaN: isNaN,
  isFinite: isFinite,
  encodeURIComponent: encodeURIComponent,
  decodeURIComponent: decodeURIComponent,
  escape: escape,
  unescape: unescape,
  undefined: undefined,
  Infinity: Infinity,
  NaN: NaN,
  performance: { now: () => Date.now() },
  alert: () => {},
  confirm: () => true,
  prompt: () => null,
  fetch: () => Promise.resolve({ json: () => Promise.resolve({}) }),
  WebSocket: class {},
  FileReader: class { readAsText() {} },
  FormData: class {},
  URL: URL,
  URLSearchParams: URLSearchParams
};

// Read the HTML file
const htmlPath = __dirname + '/../src/index.html';
const html = fs.readFileSync(htmlPath, 'utf8');

// Extract script content
const scriptMatch = html.match(/<script[^>]*>([\s\S]*?)<\/script>/);
if (!scriptMatch) {
  console.error('No script tag found');
  process.exit(1);
}

const code = scriptMatch[1];

// Create VM context
vm.createContext(context);

try {
  vm.runInContext(code, context, { filename: 'novelcraft-unified.js' });
  console.log('=== Code loaded successfully ===\n');
} catch (e) {
  console.error('Error loading code:', e.message);
  console.error(e.stack);
  process.exit(1);
}

// Now run regression tests
try {
  if (typeof context.AIRuntime === 'undefined') {
    console.error('AIRuntime not found in context');
    process.exit(1);
  }

  if (context.StoryStore) {
    context.StoryStore.load();
    console.log('StoryStore loaded. Chapters:', context.StoryStore.getChapters().length);
  }

  if (context.AIExecutionLayer) {
    context.AIExecutionLayer.resetExecutedHashes();
  }

  console.log('Running regression tests...\n');
  const results = context.AIRuntime.runRegressionTests();
  
  console.log('=== Regression Test Results ===\n');
  let passCount = 0;
  results.results.forEach(function(r) {
    const status = r.pass ? 'PASS' : 'FAIL';
    console.log('  [' + status + '] Test ' + r.id + ': ' + r.name);
    if (r.pass) passCount++;
  });
  console.log('\n' + passCount + '/' + results.results.length + ' tests passed');
  console.log('All pass: ' + results.allPass);

  if (!results.allPass) {
    console.log('\n=== Detailed failure analysis ===');
    results.results.filter(r => !r.pass).forEach(function(r) {
      console.log('  FAILED: ' + r.name);
    });
  }

  console.log('\n=== Scene Tests ===');
  try {
    var sceneA = context.AIRuntime.runSceneA();
    console.log('Scene A:', sceneA.analysis.decisions.length, 'decisions,', sceneA.analysis.issues.length, 'issues');
  } catch(e) { console.log('Scene A error:', e.message); }

  try {
    var sceneB = context.AIRuntime.runSceneB();
    console.log('Scene B:', sceneB.analysis.decisions.length, 'decisions,', sceneB.analysis.issues.length, 'issues');
  } catch(e) { console.log('Scene B error:', e.message); }

  try {
    var sceneC = context.AIRuntime.runSceneC();
    console.log('Scene C:', sceneC.analysis.decisions.length, 'decisions,', sceneC.analysis.issues.length, 'issues');
  } catch(e) { console.log('Scene C error:', e.message); }

  console.log('\n=== Action Plan Test ===');
  try {
    var apResult = context.AIRuntime.runActionPlan(0);
    console.log('Action Plan:', apResult.plans.length, 'plans generated');
    if (apResult.plans.length > 0) {
      apResult.plans.forEach(function(p) {
        console.log('  Plan:', p.action, '| priority:', p.priority, '| requiresApproval:', p.requiresApproval);
      });
    }
  } catch(e) { console.log('Action Plan error:', e.message, e.stack); }

} catch (e) {
  console.error('Error running tests:', e.message);
  console.error(e.stack);
  process.exit(1);
}
