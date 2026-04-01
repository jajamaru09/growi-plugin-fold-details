import { activate, deactivate } from './src/activate';

const PLUGIN_NAME = 'growi-plugin-fold-details';

if ((window as any).pluginActivators == null) {
  (window as any).pluginActivators = {};
}

(window as any).pluginActivators[PLUGIN_NAME] = { activate, deactivate };
