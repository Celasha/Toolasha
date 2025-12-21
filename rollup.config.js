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

export default {
  input: 'src/main.js',
  output: {
    file: 'dist/MWITools-refactor.user.js',
    format: 'iife',
    name: 'MWITools',
    banner: userscriptHeader,
    // Wrap everything in an immediately invoked function
    intro: '(function() {\n"use strict";\n',
    outro: '\n})();'
  },
  plugins: [
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
