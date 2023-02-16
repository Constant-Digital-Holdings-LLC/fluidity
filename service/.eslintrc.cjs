module.exports = {
    parser: '@typescript-eslint/parser',
    plugins: ['@typescript-eslint', 'prettier'],

    overrides: [
        {
          files: ['*.ts', '*.tsx'], 
          extends: [
            'plugin:@typescript-eslint/recommended',
            'plugin:@typescript-eslint/recommended-requiring-type-checking',
          ],
    
          parserOptions: {
            project: ['./service/tsconfig.json'], // Specify it only for TypeScript files
          },
        },
      ],


  };