import tseslint from 'typescript-eslint';
import prettierRecommended from 'eslint-plugin-prettier/recommended';

export default tseslint.config(
    {
        ignores: ['**/dist/**', 'sims/arduino/**', 'sims/fixtures/**', 'tmp/**', 'coverage/**', 'eslint.config.js']
    },
    ...tseslint.configs.recommendedTypeChecked,
    {
        files: ['**/*.ts'],
        languageOptions: {
            parserOptions: {
                projectService: true,
                tsconfigRootDir: import.meta.dirname
            }
        },
        rules: {
            //house style: short-circuit and ternary expressions as statements
            '@typescript-eslint/no-unused-expressions': ['error', { allowShortCircuit: true, allowTernary: true }]
        }
    },
    prettierRecommended
);
