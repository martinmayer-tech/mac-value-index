import {createConfig} from '@mvi/config/eslint';

// ESLint requires a default export from its config file.
export default createConfig({tsconfigRootDir: import.meta.dirname});
