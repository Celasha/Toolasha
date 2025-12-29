import resolve from '@rollup/plugin-node-resolve';
import commonjs from '@rollup/plugin-commonjs';
import banner2 from 'rollup-plugin-banner2';
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Read the userscript header
const userscriptHeader = readFileSync(join(__dirname, 'userscript-header.txt'), 'utf-8');

// Custom plugin to import CSS as raw strings
function cssRawPlugin() {
  const suffix = '?raw';
  return {
    name: 'css-raw',
    resolveId(source, importer) {
      if (source.endsWith(suffix)) {
        // Resolve relative to importer
        if (importer) {
          const basePath = dirname(importer);
          const cssPath = join(basePath, source.replace(suffix, ''));
          return cssPath + suffix; // Keep marker for load phase
        }
      }
      return null;
    },
    load(id) {
      if (id.endsWith(suffix)) {
        const cssPath = id.replace(suffix, '');
        const css = readFileSync(cssPath, 'utf-8');
        return `export default ${JSON.stringify(css)};`;
      }
      return null;
    }
  };
}

export default {
  input: 'src/main.js',
  output: {
    file: 'dist/Toolasha.user.js',
    format: 'iife',
    name: 'Toolasha',
    banner: userscriptHeader,
    // Wrap everything in an immediately invoked function
    intro: '(function() {\n"use strict";\n',
    outro: '\n})();'
  },
  plugins: [
    cssRawPlugin(),
    resolve({
      browser: true,
      preferBuiltins: false
    }),
    commonjs(),
    // Optional: Minify the code (comment out for debugging)
    // terser({
    //   format: {
    //     comments: false
    //   }
    // })
  ]
};
