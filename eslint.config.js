const js = require('@eslint/js');

module.exports = [
  js.configs.recommended,
  {
    ignores: [
      '.prettierrc.js',
      '**/.eslintrc.js',
      'admin/words.js',
      'node_modules/**',
      'bwt.xapk.out/**',
      '*.xapk'
    ]
  },
  {
    languageOptions: {
      ecmaVersion: 'latest',
      sourceType: 'commonjs',
      globals: {
        console: 'readonly',
        process: 'readonly',
        __dirname: 'readonly',
        __filename: 'readonly',
        module: 'readonly',
        require: 'readonly',
        exports: 'readonly',
        Buffer: 'readonly',
        setTimeout: 'readonly',
        clearTimeout: 'readonly',
        setInterval: 'readonly',
        clearInterval: 'readonly',
        setImmediate: 'readonly',
        clearImmediate: 'readonly',
        // Mocha globals
        describe: 'readonly',
        it: 'readonly',
        before: 'readonly',
        after: 'readonly',
        beforeEach: 'readonly',
        afterEach: 'readonly'
      }
    },
    rules: {
      indent: [
        'error',
        2,
        {
          SwitchCase: 1
        }
      ],
      'no-console': 'off',
      'no-unused-vars': [
        'error',
        {
          ignoreRestSiblings: true,
          argsIgnorePattern: '^_'
        }
      ],
      'no-var': 'error',
      'no-trailing-spaces': 'error',
      'prefer-const': 'error',
      quotes: [
        'error',
        'single',
        {
          avoidEscape: true,
          allowTemplateLiterals: true
        }
      ],
      semi: ['error', 'always']
    }
  }
];
